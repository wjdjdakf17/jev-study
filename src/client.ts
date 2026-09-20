/**
 * src/client.ts
 * -------------
 * DecisionClient 인터페이스와, 그것을 결정론적으로 흉내내는 목업 구현.
 *
 * 인터페이스만 먼저 보자:
 *
 *   const decisions = await client.decide({
 *     state: { subject, body },        // 비정형 상태 하나
 *     questions: [route, severity, refund], // 질문 여러 개 (병렬)
 *   });
 *   decisions.route.selected;          // → "billing" (타입 보장)
 *
 * 실제 Jev는 모든 질문을 "병렬 샘플링"으로 한 번에 처리한다.
 * 토큰을 순서대로 생성하는 자기회귀(autoregressive) 방식과 달리
 * 출력 전체를 한 번의 질의로 뽑기 때문에 70~500ms 밖에 안 걸리고
 * 출력 토큰 비용이 "측정이 무의미할 정도"로 싸다고 한다.
 *
 * 목업은 그 병렬성을 Promise.all로 흉내만 낸다. 중요한 건 응답
 * "모양"이다 — 문자열 파싱이 없다. 그게 이 스터디의 핵심 관찰.
 */

import {
  type Decision,
  type DecisionMap,
  type DecisionState,
  type Question,
  clamp01,
  confidenceFromDistribution,
  normalize,
} from "./types.js";

export interface DecideRequest {
  readonly state: DecisionState;
  readonly questions: readonly Question[];
}

export interface DecisionClient {
  /** 하나의 state에 대해 여러 질문을 물어 결정 묶음을 받는다. */
  decide(request: DecideRequest): Promise<DecisionMap>;
}

/* -------------------------------------------------------------------------- */
/* 목업 클라이언트 — 키워드 가중치 기반, 완전 결정론적                          */
/* -------------------------------------------------------------------------- */

/**
 * MockDecisionClient
 *
 * 실제 Jev 호출 대신 쓰는 가짜 클라이언트. 규칙:
 *
 *   1. state를 하나의 텍스트로 직렬화한다(실제 Jev는 구조화된
 *      상태도 그대로 받는다).
 *   2. 각 질문 유형별로 키워드 가중치를 합산해 점수를 만든다.
 *   3. 점수를 정규화해 확률 분포로 바꾸고, confidence를 "도출"한다.
 *
 * 결과적으로 진짜 모델처럼 동작하는 지점이 하나 있다:
 * 애매한 입력(키워드가 여러 옵션에 골고루 걸리는 경우)은
 * 분포가 평평해져 confidence가 뚝 떨어진다.
 * confidence-gated 라우팅 예제가 말이 되는 이유다.
 *
 * 같은 입력엔 항상 같은 출력(결정론적)이라 테스트도 안정적이다.
 */
export class MockDecisionClient implements DecisionClient {
  async decide(request: DecideRequest): Promise<DecisionMap> {
    const text = serializeState(request.state);

    // 질문별 결정을 "병렬"로 계산 — 실제 모델의 병렬 샘플링에 대한 오마주.
    const entries = await Promise.all(
      request.questions.map(async (q) => [q.key, await answer(q, text)] as const),
    );

    return Object.fromEntries(entries);
  }
}

/** state를 텍스트로 합친다. 값은 재귀적으로 문자열화. */
function serializeState(state: DecisionState): string {
  if (typeof state === "string") return state;
  return Object.values(state)
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join("\n");
}

async function answer(question: Question, text: string): Promise<Decision> {
  switch (question.kind) {
    case "choice":
      return answerChoice(question, text);
    case "score":
      return answerScore(question, text);
    case "noul":
      return answerNoul(question, text);
  }
}

/**
 * Choice: 각 옵션에 "옵션명이 state에 얼마나 언급/연상되는가"로 점수를 매긴다.
 * 옵션별 키워드 사전은 목업 생성 시 주입한다(아래 keywordProfile 참고).
 */
function answerChoice(
  question: Question & { kind: "choice" },
  text: string,
): Decision {
  const lower = text.toLowerCase();
  const scores = question.options.map((option) => {
    const profile = keywordProfile(option);
    return profile.reduce((acc, kw) => acc + countOccurrences(lower, kw), 0);
  });

  // 전부 0점이면 normalize가 균등 분포를 반환 — confidence는 0에 수렴.
  const probabilities = zipDistribution(question.options, normalize(scores));
  return {
    kind: "choice",
    selected: argmax(question.options, probabilities),
    probabilities,
    confidence: confidenceFromDistribution(probabilities),
  };
}

/**
 * Score: 루브릭 단계별 키워드로 점수를 매긴다.
 * 실제와 반대 방향(높은 단계가 먼저 오도록)으로 정의해도 무방하나,
 * 여기선 "낮은 단계 → 높은 단계" 순서를 타입 주석 그대로 존중한다.
 */
function answerScore(
  question: Question & { kind: "score" },
  text: string,
): Decision {
  const lower = text.toLowerCase();
  const labels = question.levels.map((l) => l.label);
  const scores = question.levels.map((level) =>
    keywordProfile(level.label).reduce(
      (acc, kw) => acc + countOccurrences(lower, kw),
      0,
    ),
  );

  const probabilities = zipDistribution(labels, normalize(scores));
  return {
    kind: "score",
    selected: argmax(labels, probabilities),
    probabilities,
    confidence: confidenceFromDistribution(probabilities),
  };
}

/**
 * Noul: 명제 프로필 키워드 히트 수를 로지스틱으로 눌러 0~1 확률로.
 * 히트가 0개면 0.5(모르겠다) — 이것도 결정론적이라 테스트 가능.
 */
function answerNoul(
  question: Question & { kind: "noul" },
  text: string,
): Decision {
  const lower = text.toLowerCase();
  const hits = keywordProfile(question.proposition).reduce(
    (acc, kw) => acc + countOccurrences(lower, kw),
    0,
  );

  // hits=0 → 0.5, hits=1 → 0.73, hits=2+ → 0.88~ 로 수렴하는 단순 곡선.
  const probabilityOfYes = clamp01(0.5 + 0.23 * hits);
  return { kind: "noul", probabilityOfYes };
}

/* -------------------------------------------------------------------------- */
/* 소규모 휴리스틱 유틸                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 옵션/라벨/명제 → 연상 키워드 목록.
 * 실제 Jev가 언어 이해로 하는 일을 아주 대략적으로 흉내 낸 것.
 * 스터디용 목업이므로 "결과가 그럴듯한 수준"이면 충분하다.
 */
function keywordProfile(seed: string): string[] {
  const profiles: Record<string, string[]> = {
    // 라우팅 옵션
    billing: ["결제", "청구", "카드", "환불", "구독", "billing", "refund"],
    technical: ["에러", "버그", "로그인", "실패", "error", "bug", "crash"],
    account: ["비밀번호", "계정", "탈퇴", "이메일 변경", "password", "account"],
    // 심각도 루브릭 (낮→높)
    cosmetic: ["오타", "ui", "정렬", "사소"],
    degraded: ["워크어라운드", "일부", "느려"],
    blocking: ["차단", "응답 없음", "전체", "장애", "다운", "critical"],
    // Noul 명제
    환불: ["환불", "취소", "refund", "결제 취소"],
  };

  const lower = seed.toLowerCase();
  for (const [key, words] of Object.entries(profiles)) {
    if (lower.includes(key)) return words;
  }
  // 프로필이 없으면 옵션명 자체를 키워드로 쓴다.
  return [seed.toLowerCase()];
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** 옵션 목록과 확률 배열을 Record로 묶는다. */
function zipDistribution(
  keys: readonly string[],
  values: readonly number[],
): Record<string, number> {
  const result: Record<string, number> = {};
  keys.forEach((key, i) => {
    result[key] = values[i] ?? 0;
  });
  return result;
}

/** 확률이 가장 높은 옵션을 고른다. 동점이면 앞쪽 옵션. */
function argmax(
  options: readonly string[],
  probabilities: Record<string, number>,
): string {
  let best = options[0] ?? "";
  let bestScore = -1;
  for (const option of options) {
    const score = probabilities[option] ?? 0;
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }
  return best;
}
