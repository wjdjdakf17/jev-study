/**
 * examples/ticket-routing.ts — 실행 예제
 *
 *   npm run example
 *
 * 세 종류의 지원 티켓을 목업 클라이언트로 판정해 본다:
 *
 *   1. 명확한 결제 문제      → confidence 높음 → 자동 라우팅
 *   2. 애매한 문제 (두 팀 걸침) → confidence 낮음 → 사람 에스컬레이션
 *   3. 환불 요청 + 전면 장애   → billing 우선 + 긴급 큐
 *
 * 실제 Jev라면 각 티켓당 70~500ms, 비용은 입력 토큰만
 * ($0.042/MTok) 계상된다. 목업이라 이 데모는 즉석에서 계산.
 */

import { MockDecisionClient } from "../src/client.js";
import { TICKET_QUESTIONS, routeTicket } from "../src/workflow.js";
import type { Decision, DecisionMap } from "../src/types.js";

interface SampleTicket {
  readonly name: string;
  readonly state: Record<string, unknown>;
}

const tickets: readonly SampleTicket[] = [
  {
    name: "1) 명확한 결제 문제",
    state: {
      subject: "카드가 두 번 결제됐어요",
      body: "어제 구독 결제가 두 번 청구됐습니다. 환불 받고 싶어요.",
    },
  },
  {
    name: "2) 애매한 티켓 (라우팅 팀이 갈림)",
    state: {
      subject: "로그인이 이상해요",
      body: "결제 페이지에 들어가려면 로그인을 해야 하는데 자꾸 에러가 나요. 카드 정보도 다시 입력하라고 하고요.",
    },
  },
  {
    name: "3) 환불 요청 + 전면 장애",
    state: {
      subject: "서비스가 다운됐고, 이번 달 결제 취소해주세요",
      body: "새벽부터 전체 기능이 응답 없음입니다. 장애 중이니 환불 처리해 주세요.",
    },
  },
];

async function main(): Promise<void> {
  const client = new MockDecisionClient();

  for (const ticket of tickets) {
    console.log(`\n===== ${ticket.name} =====`);
    console.log(`제목: ${String(ticket.state.subject)}`);

    // 질문 셋을 한 번의 decide 호출에 — 병렬 질의의 형태.
    const decisions: DecisionMap = await client.decide({
      state: ticket.state,
      questions: [...TICKET_QUESTIONS],
    });

    printDecision("라우팅", decisions["route"]);
    printDecision("심각도", decisions["severity"]);
    printDecision("환불 의사", decisions["wantsRefund"]);

    // 결정을 정책(if문)에 통과시켜 행동을 결정.
    const outcome = routeTicket(decisions);
    if (outcome.action === "route") {
      console.log(
        `→ 결과: ${outcome.team} 팀으로 라우팅` +
          `${outcome.urgent ? " (긴급!)" : ""} — ${outcome.reason}`,
      );
    } else {
      console.log(`→ 결과: 사람 검토로 에스컬레이션 — ${outcome.reason}`);
    }
  }

  console.log(
    "\n※ 목업 클라이언트 데모입니다. 실제 Jev 얼리 액세스에서는 " +
      "같은 모양의 결정이 보정된 확률로 돌아옵니다.",
  );
}

function printDecision(label: string, decision: Decision | undefined): void {
  if (decision === undefined) return;
  if (decision.kind === "choice" || decision.kind === "score") {
    const dist = Object.entries(decision.probabilities)
      .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
      .join(" · ");
    console.log(
      `  ${label}: ${decision.selected} ` +
        `(confidence ${decision.confidence.toFixed(2)}) [${dist}]`,
    );
  } else {
    console.log(
      `  ${label}: P(yes) = ${decision.probabilityOfYes.toFixed(2)}`,
    );
  }
}

void main();
