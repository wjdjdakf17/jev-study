/**
 * src/calibration.ts
 * ------------------
 * "캘리브레이션(calibration)"을 코드로 이해하기 위한 유틸.
 *
 * Jev를 설명하는 데 가장 중요한 개념이 이거라고 본다:
 *
 *   잘 보정된 모델은 "80% 확률"이라고 말한 예측이
 *   실제로 (충분히 많이 반복했을 때) 80% 정도 일어난다.
 *
 * LLM에 "confidence를 말해봐"라고 하면 대개 과신(overconfident)하고
 * 일관성도 없다. 공식 발표의 표현을 빌리면 —
 * "95% 잘하는 일을 5% 못하는 때를 스스로 말하지 못하면,
 *  그 일은 자동화할 수 없다."
 *
 * Jev의 학습법 RLCD(Reinforcement Learning for Calibrated Decisions)는
 * 이름부터 "보정된 결정"을 최적화 대상으로 삼는다.
 * RLHF가 인간 선호를, RLVR이 검증 가능한 보상을 최적화한다면,
 * RLCD는 "인식적으로 정직한 확률"을 최적화한다는 것.
 *
 * 아래 함수들은 보정을 측정하는 표준 도구들이다.
 * Brier score와 신뢰도(reliability) 버킷 — 실제 평가에 바로 쓸 수 있다.
 */

export interface BinaryPrediction {
  /** 모델이 말한 "참일 확률" (0~1) */
  readonly predicted: number;
  /** 실제 결과. 참이면 1, 거짓이면 0. */
  readonly outcome: 0 | 1;
}

/**
 * Brier score — 확률 예측의 정확도를 재는 대표 지표.
 *
 *   mean((predicted - outcome)^2)
 *
 *   - 완벽한 예측(확신하고 맞음):     0
 *   - 완벽하게 틀림(확신하고 틀림):   1
 *   - 아무 정보 없는 0.5 예측:        0.25
 *
 * 여기서 중요한 통찰: "확신하고 틀리면" 벌점이 가장 크다.
 * 즉 Brier 점수가 낮은 모델은 겸손해야 한다. 캘리브레이션 = 정직함에
 * 점수를 다는 셈이다.
 */
export function brierScore(predictions: readonly BinaryPrediction[]): number {
  if (predictions.length === 0) return 0;
  const sum = predictions.reduce(
    (acc, p) => acc + (p.predicted - p.outcome) ** 2,
    0,
  );
  return sum / predictions.length;
}

export interface ReliabilityBucket {
  /** 버킷 구간. 예: [0.7, 0.8) — "0.7~0.8 확률로 참이라고 한 예측들" */
  readonly range: readonly [number, number];
  /** 그 구간에 든 예측 수 */
  readonly count: number;
  /** 구간의 평균 예측 확률 */
  readonly meanPredicted: number;
  /** 구간 내 예측의 실제 발생 비율 */
  readonly observedFrequency: number;
  /** |평균 예측 - 실제 비율|. 0에 가까울수록 잘 보정됨. */
  readonly gap: number;
}

/**
 * 신뢰도 곡선(reliability diagram)용 버킷팅.
 *
 * 확률을 0.1 폭 구간으로 나눠, 구간별로
 * "말한 확률의 평균" vs "실제로 일어난 비율"을 비교한다.
 *
 * 잘 보정된 모델: 모든 구간에서 gap ≈ 0 (대각선 위에 점이 박힘)
 * 과신한 모델:   높은 구간에서 observedFrequency가 prediction보다 낮게 처짐
 */
export function reliabilityBuckets(
  predictions: readonly BinaryPrediction[],
  bucketWidth = 0.1,
): ReliabilityBucket[] {
  const buckets: ReliabilityBucket[] = [];

  for (let start = 0; start < 1; start += bucketWidth) {
    const end = start + bucketWidth;
    // 마지막 구간은 1.0을 포함하도록 닫아준다.
    const inBucket = predictions.filter((p) =>
      start + bucketWidth >= 1
        ? p.predicted >= start && p.predicted <= 1
        : p.predicted >= start && p.predicted < end,
    );
    if (inBucket.length === 0) continue;

    const meanPredicted =
      inBucket.reduce((acc, p) => acc + p.predicted, 0) / inBucket.length;
    const observedFrequency =
      inBucket.reduce((acc, p) => acc + p.outcome, 0) / inBucket.length;

    buckets.push({
      range: [round(start), round(end)],
      count: inBucket.length,
      meanPredicted: round(meanPredicted),
      observedFrequency: round(observedFrequency),
      gap: round(Math.abs(meanPredicted - observedFrequency)),
    });
  }

  return buckets;
}

/**
 * ECE(Expected Calibration Error) — 보정의 대표 요약 지표.
 *
 *   ECE = Σ (버킷 샘플 수 / 전체) × |버킷 평균 확신 - 버킷 실제 적중률|
 *
 * 신뢰도 버킷의 gap을 샘플 수로 가중 평균한 값. 0에 가까울수록 잘 보정됨.
 * Jev류 모델의 공개 평가(예: 오픈소스 구현 jevlike)가 top-1/top-3와
 * 함께 찍는 지표이기도 하다 — "확률을 보고하는 모델"에는 정확도만큼
 * 중요한 숫자다.
 *
 * 예: 0.9 구간에서 평균 0.9 확신했는데 실제 적중률이 0.7이면
 * 그 버킷의 gap은 0.2. ECE는 이 gap들이 전체에서 차지하는 비중만큼 더해진다.
 */
export function ece(
  predictions: readonly BinaryPrediction[],
  bucketWidth = 0.1,
): number {
  const total = predictions.length;
  if (total === 0) return 0;

  // 버킷별 (비중 × gap)의 합 — reliabilityBuckets의 gap 정의와 동일한 식.
  return reliabilityBuckets(predictions, bucketWidth).reduce(
    (acc, bucket) => acc + (bucket.count / total) * bucket.gap,
    0,
  );
}

/** 로그에 찍기 좋게 반올림. 계산 자체는 원값으로 하는 것과 무관. */
function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
