/**
 * src/types.ts
 * ------------
 * Jev(TypeSafe AI의 "System One Model")가 공개한 핵심 개념을
 * TypeScript 타입으로 옮겨 본 것.
 *
 * ⚠️ 주의: 이 파일은 공식 API 클라이언트가 아니다. Jev는 얼리 액세스
 * 모델이라 실제 엔드포인트/스키마 대신, 발표 자료에 공개된
 * "질의 → 결정" 개념(state / questions / decisions)을 내 방식대로
 * 모델링한 스터디 코드다.
 *
 * Jev의 한 줄 정의:
 *   "프론티어 지능을 가진 함수 호출"
 *   — 비정형 state가 들어가고, 타입으로 정의된 확률적 결정이 나온다.
 *
 * LLM이 "문장(토큰 시퀀스)"을 생성하는 것과 달리, Jev는 애초에
 * 가능한 출력 구조를 질의에 정의해 둔다. 그래서 타입 에러가
 * "수학적으로 불가능"하고, 모든 답에 보정된 확률이 붙는다.
 */

/**
 * 결정의 재료가 되는 "상태(state)".
 *
 * LLM의 입력이 "순차적인 대화 메시지(seq messages)"를 강조하는 것과
 * 대비되게, Jev는 "구조화된 프로그램 상태"를 강조한다.
 * 판단에 필요한 증거만 담아야 하고, 갖고 있는 정보를 전부 던지면
 * 오히려 흐려진다(공식 문서의 distractor 취약점 참고).
 */
export type DecisionState = string | Record<string, unknown>;

/** 질문을 식별하는 키. 하나의 state에 여러 질문을 병렬로 물을 수 있다. */
export type QuestionKey = string;

/* -------------------------------------------------------------------------- */
/* 질문 프리미티브 3종: Choice / Score / Noul                                  */
/* -------------------------------------------------------------------------- */

/**
 * Choice — 정의된 선택지 중 하나를 고른다.
 *
 * 예: 이 티켓은 어느 팀으로 가야 하나? (결제 | 기술지원 | 계정)
 * 결과: 선택된 옵션 + 전체 옵션에 걸친 확률 분포 + confidence
 *
 * 참고: cardinality(선택지 수)는 최대 255. 그 이상은
 * "1단계 스코어링 → 2단계 선택"의 2단계 질의로 나눈다고 공식 블로그에.
 */
export interface ChoiceQuestion {
  readonly kind: "choice";
  readonly key: QuestionKey;
  readonly question: string;
  readonly options: readonly string[];
}

/**
 * Score — 설명(rubric)이 달린 순서 척도 위에서 평가한다.
 *
 * 예: 이 버그의 심각도는? (치명적 | 대체 가능 | 사소함)
 * 단순 "1~10점"과 다른 점: 각 단계에 "무엇을 의미하는지" 설명을 붙인다.
 * 해석의 여지를 줄이는 게 목적이라 설명이 곧 스펙이다.
 */
export interface ScoreQuestion {
  readonly kind: "score";
  readonly key: QuestionKey;
  readonly question: string;
  /** 낮은 단계 → 높은 단계 순서로 정의한다. */
  readonly levels: readonly RubricLevel[];
}

export interface RubricLevel {
  readonly label: string;
  readonly description: string;
}

/**
 * Noul — yes/no 명제의 확률만 돌려준다.
 *
 * 예: "사용자가 환불을 요청하고 있다" — 참일 확률 0.87
 *
 * 이름의 어원이 궁금했는데 공식 문서에서도 "not-yes/no 로직" 계열의
 * 조어로만 설명한다. Choice/Score와 달리 confidence 필드가 없다.
 * 확률 그 자체가 애플리케이션이 쓸 신호다.
 */
export interface NoulQuestion {
  readonly kind: "noul";
  readonly key: QuestionKey;
  /** 참/거짓을 판단할 명제. 질문이 아니라 "명제"라는 점이 포인트. */
  readonly proposition: string;
}

/** 세 프리미티브의 유니언. 같은 state에 섞어서 병렬로 물을 수 있다. */
export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

/* -------------------------------------------------------------------------- */
/* 결정(decisions) — 문자열이 아니라 "값 + 확률"                              */
/* -------------------------------------------------------------------------- */

/** 선택지/단계별 확률 분포. 키는 옵션 또는 루브릭 라벨. */
export type ProbabilityDistribution = Readonly<Record<string, number>>;

export interface ChoiceDecision {
  readonly kind: "choice";
  readonly selected: string;
  readonly probabilities: ProbabilityDistribution;
  readonly confidence: number;
}

export interface ScoreDecision {
  readonly kind: "score";
  readonly selected: string;
  readonly probabilities: ProbabilityDistribution;
  readonly confidence: number;
}

export interface NoulDecision {
  readonly kind: "noul";
  readonly probabilityOfYes: number;
}

export type Decision = ChoiceDecision | ScoreDecision | NoulDecision;

/** 질문 key → 결정. Jev가 하나의 질의로 여러 질문을 병렬 처리하는 모습. */
export type DecisionMap = Readonly<Record<QuestionKey, Decision>>;

/* -------------------------------------------------------------------------- */
/* confidence: 분포에서 "도출"하는 값                                          */
/* -------------------------------------------------------------------------- */

/**
 * confidence를 확률 분포에서 계산한다.
 *
 * 공식 문서는 confidence를 "확률 분포에서 계산된 요약치"라고만 설명하고
 * 정확한 수식은 공개하지 않았다. 여기서는 내 기준으로
 * "1위 확률 − 2위 확률" 갭을 쓴다:
 *
 *   - 분포가 한 옵션에 몰려 있으면(0.92 vs 0.05 vs 0.03) → confidence ≈ 0.87
 *   - 두 옵션이 비등하면(0.51 vs 0.49)              → confidence ≈ 0.02
 *
 * 실제 모델의 confidence와 같은 값은 아니지만, 하고 싶은 말은 같다:
 * "답이 아니라, 답의 확실함을 따로 보고하라."
 */
export function confidenceFromDistribution(
  probabilities: ProbabilityDistribution,
): number {
  const values = Object.values(probabilities);
  if (values.length === 0) return 0;

  // 내림차순 정렬 뒤 1위와 2위의 갭.
  const sorted = [...values].sort((a, b) => b - a);
  const first = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  return clamp01(first - second);
}

/**
 * 점수 배열을 정규화해 확률 배열로 만든다(합 = 1).
 * 키 결합(zip)은 호출자가 — 여기선 순서만 담당한다.
 */
export function normalize(scores: readonly number[]): number[] {
  const clipped = scores.map((s) => Math.max(0, s));
  const sum = clipped.reduce((a, b) => a + b, 0);

  // 전부 0이면 "정보 없음" — 균등 분포로. (빈 배열이면 빈 배열 반환)
  if (sum <= 0) {
    return clipped.map(() => 1 / clipped.length);
  }

  const scaled = clipped.map((s) => s / sum);

  // 부동소수 합이 정확히 1이 아니게 나오면 마지막 원소에 보정.
  const drift = 1 - scaled.reduce((acc, s) => acc + s, 0);
  const lastIndex = scaled.length - 1;
  if (lastIndex >= 0) {
    scaled[lastIndex] = Math.max(0, (scaled[lastIndex] ?? 0) + drift);
  }
  return scaled;
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
