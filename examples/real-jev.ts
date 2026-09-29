/**
 * examples/real-jev.ts — 목업이 아니라 진짜 Jev로 티켓 라우팅
 * ──────────────────────────────────────────────────────────
 *   REQUESTY_API_KEY=rky_... npm run example:real
 *
 * examples/ticket-routing.ts와 같은 3종 티켓을 진짜 Jev에게 물어본다:
 *   1. 명확한 결제 문제
 *   2. 애매한 티켓 (라우팅 팀이 갈림)
 *   3. 환불 요청 + 전면 장애
 *
 * 관찰 포인트:
 *   - 목업 대비 실제 confidence/확률 분포의 모양
 *   - 애매한 티켓(2번)에서 confidence 게이트에 걸리는가 — 그리고
 *     우리 confidenceFromDistribution(1위-2위 갭)과 실제 confidence의 차이
 *   - end-to-end 응답 시간 (공식 주장 70~500ms — 라우터 경유라 조금 더 걸림)
 */

import { RequestyDecisionClient } from "../src/providers/requesty.js";
import { TICKET_QUESTIONS, routeTicket } from "../src/workflow.js";
import { confidenceFromDistribution } from "../src/types.js";
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
  const apiKey = process.env.REQUESTY_API_KEY;
  if (!apiKey) {
    console.error("REQUESTY_API_KEY 환경변수가 필요합니다 (app.requesty.ai/api-keys)");
    process.exit(1);
  }

  const client = new RequestyDecisionClient({ apiKey });

  for (const ticket of tickets) {
    console.log(`\n===== ${ticket.name} =====`);

    const started = performance.now();
    let decisions: DecisionMap;
    try {
      decisions = await client.decide({
        state: ticket.state,
        questions: [...TICKET_QUESTIONS],
      });
    } catch (err) {
      console.error(`호출 실패: ${String(err)}`);
      return;
    }
    const elapsed = Math.round(performance.now() - started);

    console.log(`응답 시간: ${elapsed}ms (질문 3개 병렬)`);
    printDecision("라우팅", decisions["route"]);
    printDecision("심각도", decisions["severity"]);
    printDecision("환불 의사", decisions["wantsRefund"]);

    // 실제 confidence vs 우리 휴리스틱(1위-2위 갭) 비교
    const route = decisions["route"];
    if (route?.kind === "choice") {
      const ours = confidenceFromDistribution(route.probabilities);
      console.log(
        `  confidence 비교 — Jev 실측 ${route.confidence.toFixed(2)} vs 우리 갭식 ${ours.toFixed(2)}`,
      );
    }

    const outcome = routeTicket(decisions);
    if (outcome.action === "route") {
      console.log(
        `→ 결과: ${outcome.team} 팀으로 라우팅${outcome.urgent ? " (긴급!)" : ""} — ${outcome.reason}`,
      );
    } else {
      console.log(`→ 결과: 사람 검토 — ${outcome.reason}`);
    }
  }
}

function printDecision(label: string, decision: Decision | undefined): void {
  if (!decision) return;
  if (decision.kind === "choice" || decision.kind === "score") {
    const dist = Object.entries(decision.probabilities)
      .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
      .join(" · ");
    console.log(
      `  ${label}: ${decision.selected} (confidence ${decision.confidence.toFixed(2)}) [${dist}]`,
    );
  } else {
    console.log(`  ${label}: P(yes) = ${decision.probabilityOfYes.toFixed(2)}`);
  }
}

void main();
