/**
 * tests/client.test.ts — 목업 클라이언트의 행동 검증.
 *
 * 목업이지만 지켜야 할 계약(contract)은 실제 Jev와 같다:
 *   1. 결정 문자열이 아니라 "값 + 확률"이 온다 (파싱 불필요)
 *   2. 같은 입력에는 같은 결정이 온다 (결정론적 — 실제 모델과 다른 점)
 *   3. 선택지 밖의 값이 나오지 않는다 (타입 안전성)
 *   4. 애매한 입력은 confidence가 떨어진다 (보정의 성질)
 */
import { describe, expect, it } from "vitest";

import { MockDecisionClient } from "../src/client.js";
import type { Question } from "../src/types.js";

const routeQuestion: Question = {
  kind: "choice",
  key: "route",
  question: "이 티켓을 처리할 팀은?",
  options: ["billing", "technical", "account"],
};

const noulQuestion: Question = {
  kind: "noul",
  key: "wantsRefund",
  proposition: "사용자가 환불을 요청하고 있다",
};

describe("MockDecisionClient", () => {
  it("선택지 안의 값만 반환한다 — 타입 안전성의 목업 버전", async () => {
    const client = new MockDecisionClient();
    const decisions = await client.decide({
      state: "카드가 두 번 결제되어 환불을 원합니다",
      questions: [routeQuestion],
    });

    const route = decisions["route"];
    if (route?.kind !== "choice") throw new Error("choice 결정이어야 함");
    expect(route.probabilities).toHaveProperty("billing");
    expect(route.probabilities).toHaveProperty("technical");
    expect(route.probabilities).toHaveProperty("account");
    // 분포 합은 1
    const sum = Object.values(route.probabilities).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("같은 입력에는 같은 결정이 온다 (결정론적 목업)", async () => {
    const client = new MockDecisionClient();
    const request = {
      state: "결제 오류가 발생했습니다",
      questions: [routeQuestion, noulQuestion],
    } as const;

    const [first, second] = await Promise.all([
      client.decide(request),
      client.decide(request),
    ]);
    expect(first).toEqual(second);
  });

  it("명확한 티켓은 confidence가 높고, 애매한 티켓은 낮다", async () => {
    const client = new MockDecisionClient();

    const clear = await client.decide({
      state: { subject: "환불 요청", body: "카드 이중 결제. 환불해주세요." },
      questions: [routeQuestion],
    });
    const ambiguous = await client.decide({
      state: {
        subject: "로그인 문제인지 결제 문제인지 모르겠어요",
        body: "로그인하니 결제 에러가 나고, 비밀번호도 물어봐요",
      },
      questions: [routeQuestion],
    });

    const clearRoute = clear["route"];
    const ambiguousRoute = ambiguous["route"];
    if (
      clearRoute?.kind !== "choice" ||
      ambiguousRoute?.kind !== "choice"
    ) {
      throw new Error("choice 결정이어야 함");
    }

    // 명확한 쪽이 애매한 쪽보다 확실히 높아야 —
    // 이 대소 관계가 confidence-gated 라우팅의 전제다.
    expect(clearRoute.confidence).toBeGreaterThan(
      ambiguousRoute.confidence,
    );
    expect(clearRoute.selected).toBe("billing");
  });

  it("Noul은 0~1 사이 확률을 반환한다", async () => {
    const client = new MockDecisionClient();
    const decisions = await client.decide({
      state: "환불하고 싶습니다. 결제 취소 부탁드려요.",
      questions: [noulQuestion],
    });

    const refund = decisions["wantsRefund"];
    if (refund?.kind !== "noul") throw new Error("noul 결정이어야 함");
    expect(refund.probabilityOfYes).toBeGreaterThan(0.5);
    expect(refund.probabilityOfYes).toBeLessThanOrEqual(1);
  });

  it("셔플드 컨텍스트 컨트롤: 맞는 state의 confidence가 섞인 state보다 높다", async () => {
    // 오픈소스 구현 jevlike의 평가 방법론 — 각 질문(메뉴)에 엉뚱한
    // context를 짝지어도 모델이 그 컨트롤을 "이겨야" 학습된 것이다.
    // 목업에 같은 잣대를 적용해 보는 시연 테스트.
    const client = new MockDecisionClient();
    const question: Question = {
      kind: "choice",
      key: "route",
      question: "이 티켓을 처리할 팀은?",
      options: ["billing", "technical", "account"],
    };

    // 정상 짝: 결제 티켓 + 라우팅 질문 → 높은 confidence
    const matched = await client.decide({
      state: { subject: "이중 결제", body: "카드로 구독 결제가 두 번 청구됐습니다." },
      questions: [question],
    });
    // 컨트롤: 라우팅과 무관한 state를 짝지었을 때 → 분포가 평평해짐
    const shuffled = await client.decide({
      state: { subject: "주말 날씨", body: "주말 행사 일정 문의입니다." },
      questions: [question],
    });

    const matchedRoute = matched["route"];
    const shuffledRoute = shuffled["route"];
    if (matchedRoute?.kind !== "choice" || shuffledRoute?.kind !== "choice") {
      throw new Error("choice 결정이어야 함");
    }

    expect(matchedRoute.confidence).toBeGreaterThan(shuffledRoute.confidence);
  });

  it("질문 여러 개를 한 번의 호출에 섞어 쓸 수 있다 (병렬 질의 형태)", async () => {
    const client = new MockDecisionClient();
    const scoreQuestion: Question = {
      kind: "score",
      key: "severity",
      question: "심각도는?",
      levels: [
        { label: "cosmetic", description: "치장 수준" },
        { label: "degraded", description: "우회로 있음" },
        { label: "blocking", description: "완전 차단" },
      ],
    };

    const decisions = await client.decide({
      state: "전체 서비스가 응답 없음. 장애입니다.",
      questions: [routeQuestion, scoreQuestion, noulQuestion],
    });

    const severity = decisions["severity"];
    if (severity?.kind !== "score") throw new Error("score 결정이어야 함");
    expect(severity.selected).toBe("blocking");
    // 나머지 질문들도 모두 응답되어 있어야 한다.
    expect(decisions["route"]).toBeDefined();
    expect(decisions["wantsRefund"]).toBeDefined();
  });
});
