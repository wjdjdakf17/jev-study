/**
 * tests/requesty.test.ts — Requesty 프로바이더의 순수 변환 계약.
 * 네트워크 없이 요청/응답 번역이 정확한지만 검증한다.
 * (실제 호출은 examples/real-jev.ts — REQUESTY_API_KEY 필요)
 */
import { describe, expect, it } from "vitest";

import {
  RequestyDecisionClient,
  fromRequestyAnswers,
  toRequestyQuestions,
} from "../src/providers/requesty.js";
import type { Question } from "../src/types.js";

const questions: Question[] = [
  {
    kind: "choice",
    key: "route",
    question: "이 티켓을 처리할 팀은?",
    options: ["billing", "technical", "account"],
  },
  {
    kind: "score",
    key: "severity",
    question: "심각도는?",
    levels: [
      { label: "cosmetic", description: "치장 수준" },
      { label: "degraded", description: "우회로 있음" },
      { label: "blocking", description: "완전 차단" },
    ],
  },
  { kind: "noul", key: "wantsRefund", proposition: "사용자가 환불을 요청하고 있다" },
];

describe("toRequestyQuestions", () => {
  it("우리 질문 3종을 Requesty questions 형태로 옮긴다", () => {
    const out = toRequestyQuestions(questions);

    expect(out["route"]).toEqual({
      type: "choice",
      instructions: "이 티켓을 처리할 팀은?",
      criteria: { billing: "billing", technical: "technical", account: "account" },
    });
    expect(out["severity"]).toEqual({
      type: "score",
      instructions: "심각도는?",
      criteria: ["cosmetic", "degraded", "blocking"], // 낮은→높은 순
    });
    // Noul은 우리의 '명제'가 instructions 자리로 간다
    expect(out["wantsRefund"]).toEqual({
      type: "noul",
      instructions: "사용자가 환불을 요청하고 있다",
    });
  });
});

describe("fromRequestyAnswers", () => {
  it("choice 응답을 그대로 Decision으로", () => {
    const decisions = fromRequestyAnswers(questions, {
      route: {
        type: "choice",
        choice: "billing",
        confidence: 0.92,
        probabilities: { billing: 0.92, technical: 0.06, account: 0.02 },
      },
    });

    const route = decisions["route"];
    if (route?.kind !== "choice") throw new Error("choice여야 함");
    expect(route.selected).toBe("billing");
    expect(route.confidence).toBeCloseTo(0.92, 5);
    expect(route.probabilities["technical"]).toBeCloseTo(0.06, 5);
  });

  it("score 응답의 index를 우리 라벨로 재매핑한다", () => {
    const decisions = fromRequestyAnswers(questions, {
      severity: {
        type: "score",
        score: 2,
        confidence: 0.97,
        legend: { "0": "cosmetic", "1": "degraded", "2": "blocking" },
        probabilities: { "0": 0.0, "1": 0.03, "2": 0.97 },
      },
    });

    const severity = decisions["severity"];
    if (severity?.kind !== "score") throw new Error("score여야 함");
    expect(severity.selected).toBe("blocking"); // index 2 → label
    expect(severity.probabilities["degraded"]).toBeCloseTo(0.03, 5); // "1" → 라벨
    expect(severity.probabilities["blocking"]).toBeCloseTo(0.97, 5);
  });

  it("noul 응답은 probabilityOfYes로", () => {
    const decisions = fromRequestyAnswers(questions, {
      wantsRefund: { type: "noul", noul: 0.87 },
    });
    const refund = decisions["wantsRefund"];
    if (refund?.kind !== "noul") throw new Error("noul여야 함");
    expect(refund.probabilityOfYes).toBeCloseTo(0.87, 5);
  });
});

describe("RequestyDecisionClient (주입 fetch로 HTTP 계약 검증)", () => {
  it("올바른 요청을 보내고 assistant JSON을 파싱해 돌려준다", async () => {
    let capturedBody = "";
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ wantsRefund: { type: "noul", noul: 0.99 } }) } },
          ],
        }),
        { status: 200 },
      );
    };

    const client = new RequestyDecisionClient({ apiKey: "test-key", fetch: fakeFetch });
    const decisions = await client.decide({
      state: { subject: "환불 요청" },
      questions: [questions[2]!],
    });

    // 요청 모양 — 문서 계약 그대로인지
    const body = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(body["model"]).toBe("typesafe/jev-latest");
    expect(body["response_format"]).toEqual({
      type: "questions",
      questions: { wantsRefund: { type: "noul", instructions: "사용자가 환불을 요청하고 있다" } },
    });
    // state는 user 메시지 텍스트로 직렬화 (문자열 값은 그대로)
    expect(body["messages"]).toEqual([
      { role: "user", content: "subject: 환불 요청" },
    ]);

    const refund = decisions["wantsRefund"];
    if (refund?.kind !== "noul") throw new Error("noul여야 함");
    expect(refund.probabilityOfYes).toBeCloseTo(0.99, 5);
  });

  it("에러 응답은 명시적으로 throw", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("quota exceeded", { status: 402 });
    const client = new RequestyDecisionClient({ apiKey: "test-key", fetch: fakeFetch });

    await expect(
      client.decide({ state: "x", questions: [questions[2]!] }),
    ).rejects.toThrow(/402/);
  });
});
