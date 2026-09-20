# 05. 참고자료

## 1차 소스 (TypeSafe 공식)

| 자료 | 링크 |
| --- | --- |
| 발표: Introducing System One Models & Jev | https://typesafe.ai/blog/introducing-system-one-models-and-jev |
| System One 개념 문서 | https://typesafe.ai/system-one |
| 질문 프리미티브 (Choice / Score / Noul) | https://typesafe.ai/choice · /score · /noul |
| State 설계 가이드 | https://typesafe.ai/state |
| Confidence 설명 | https://typesafe.ai/confidence |
| Confidence-gated routing 패턴 | https://typesafe.ai/confidence-gated-routing |
| Jev 1.13 limitations (jaggedness) | https://typesafe.ai/jev-1.13-jaggedness |
| RLCD / AI primer | https://typesafe.ai/ai-primer |

> 발표일: 2026-09-15. 이 노트는 2026-09-20 기준 공개 자료 기준.

## 분석 · 커뮤니티

| 자료 | 링크 |
| --- | --- |
| Requesty 딥다이브 (질문 유형/프라이싱/한계 정리) | https://www.requesty.ai/blog/typesafe-jev-explained |
| Hacker News 토론 (~1,900점) | https://news.ycombinator.com/item?id=49717558 |
| LangChain 블로그 (LLM 앱에 끼칠 영향) | https://blog.langchain.com |

## 커뮤니티 데모 (발표 직후, 자체 측정)

- Doom 봇 — 초당 10회 질의, ~$7/시간 (TypeSafe 팀)
- 광고 724개 분석, 40초 / $0.09 — Matt Berman
- 뉴스 384개 트리아지, 24.9초 / $0.19 — Elvis Sun
- Subway Surfers, 50게임 동시 / $0.01 미만 — Max Blade
- 브라우저 에이전트 항공권 검색, 7초 / $0.0039 — Gregor Zunic
- 온체인 트레이딩 봇, 300ms 블록 — Jarrod Watts

## 이 레포의 코드가 다루는 개념 대응표

| 코드 | 대응 개념 |
| --- | --- |
| `src/types.ts` — ChoiceQuestion / ScoreQuestion / NoulQuestion | 질문 프리미티브 3종 |
| `src/types.ts` — confidenceFromDistribution | confidence = 분포에서 도출하는 요약치 |
| `src/client.ts` — DecisionClient.decide({state, questions}) | 하나의 state에 대한 병렬 질의 |
| `src/workflow.ts` — routeTicket | confidence-gated routing 패턴 |
| `src/calibration.ts` — brierScore / reliabilityBuckets | 보정(calibration)의 독립 검증 |

## 각주

- 이 레포의 목업 클라이언트는 실제 Jev API가 아니다 — 공개된
  개념을 TypeScript로 모델링한 학습용 흉내다. 실 API 형태는
  얼리 액세스 문서를 따른다.
- 비용/속도 수치는 전부 벤더/크리에이터 셀프 리포트다.
  비판적 맥락은 [04](04-use-cases-limits.md) 참고.
