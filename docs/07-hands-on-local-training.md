# 07. 실습 — 로컬에서 결정 모델을 직접 학습시켜 보다

> 2026-09-29 실시. [jevlike](06-jevlike-open-implementation.md)(Jev와 같은
> 입출력 계약의 오픈소스 구현)를 이 레포의 티켓 세계관으로 학습시키고,
> 목업 데모의 애매한 티켓에 실제 확률 분포를 물어본 기록.
> 진짜 Jev API와의 비교는 아래 "실측 경로" 참고.

## 무료 실측 경로 조사 (2026-09-29 기준)

| 경로 | 결과 |
| --- | --- |
| TypeSafe 직접 API | 카드 등록 필수, 무료 티어 없음 |
| TypeSafe 콘솔 플레이그라운드 | ❌ **로그인해도 크레딧 필요 — 실측 확인** (Run 시 "Billing error: no available TypeSafe API credits") |
| Requesty 라우터 | 계정 생성 가능하나 이 계정 무료 크레딧 없음 ($0.00) |
| Vercel AI Gateway | 9/25까지 무료 프로모션 — 종료됨 |
| Cloudflare Workers AI | Jev 미탑재 (AI Gateway 프록시 얘기였음) |
| **jevlike 로컬** | **✅ 100% 무료 — 본 문서의 실습 경로** |

> 2026-09-29 현재 "지불 없이 진짜 Jev를 호출하는 경로"는 존재하지 않는다.
> 학습 목적의 무료 실습은 jevlike로 충분하고(본 문서), 진짜 Jev 비교가
> 필요해지는 순간 TypeSafe 크레딧 또는 Requesty 충전(모두 최소 충전
> 1회, 실습 규모 비용은 몇 센트 미만)로 3중 비교(목업/로컬/Jev)가 열린다.

## 한 일

1. **데이터셋 제작** — `scripts/make_ticket_data.py`가 생성.
   한국어 지원 티켓 72(train)/12(val)/17(test)행. 팀별 명확 티켓
   (billing/technical/account 각 24+4+4) + **test에만 애매한 티켓 5개**
   (두 팀 신호 혼합). 라벨은 지배적 신호 기준.
2. **학습** — 옵션-어텐션 head를 tiny 바이트 인코더 위에 학습:
   ```bash
   uv run jevlike-train data/tickets/train.jsonl \
     --validation data/tickets/validation.jsonl \
     --output runs/tickets.pt --context-tokens 384 \
     --device auto --epochs 60
   ```
   (한글이 UTF-8 3바이트라 기본 192바이트 절단을 피하려 384로 상향.
   Apple Silicon MPS에서 수십 초)
3. **평가** — jevlike-eval이 [06](06-jevlike-open-implementation.md)에서
   공부한 지표를 그대로 찍어준다.

## 결과

| 지표 | 8 epoch | **60 epoch** | 셔플드 컨트롤(60ep) |
| --- | --- | --- | --- |
| top-1 정확도 | 0.588 | **0.882** (15/17) | 0.235 |
| ECE (보정 오차) | 0.293 | **0.056** | 0.703 |
| validation NLL | 0.562 | **0.00013** | — |

읽을 거리:

- **셔플드 컨트롤 격차** (0.88 vs 0.24) — 문맥을 섞으면 무너지므로,
  "외운 것"이 아니라 문맥-질문 연결을 배웠다는 증거. 이 컨트롤을
  평가에 넣는 jevlike의 방법론([06])이 실제로 판별력이 있다는 확인.
- **ECE 0.056** — 이 토이 규모에서도 보정이 잘 맞는다. "confidence를
  믿고 게이트를 걸 수 있는 모델"이라는 RAG... 가 아니라 결정 모델의
  핵심 성질이 재현됐다.
- 8→60 epoch에서 정확도만 오른 게 아니라 **보정이 함께 좋아졌다**
  (0.29→0.06). 언더트레인된 모델은 확신도 서투르다.

## 목업 vs 학습된 모델 — 같은 애매한 티켓, 다른 판단

`examples/ticket-routing.ts`의 2번 티켓(로그인+결제 페이지+에러)에 대해:

| | 라우팅 결과 | 분포 |
| --- | --- | --- |
| `MockDecisionClient` (키워드) | confidence 0.2 → **사람 검토** | billing 40% · technical 60% |
| **학습된 jevlike (실측)** | **technical 99.98%** | billing 0.00% · technical 99.98% · account 0.02% |

그리고 3번 티켓(환불 요청 + 전면 장애):

| | 라우팅 결과 |
| --- | --- |
| 목업 | billing 100% (환불/결제 키워드 과잉) |
| **학습된 jevlike** | **billing 99.96%** — 같은 결론, 그러나 근거가 다름: 키워드가 아니라 "환불 의도가 장애 묘사를 지배한다"는 문맥 학습 |

배운 것: 키워드 목업은 단어의 **공존**만 보고 confidence를 깎지만,
학습된 모델은 **어떤 신호가 이 티켓의 지배적 의도인지**를 배운다.
물론 이 모델은 72개 티켓으로 배운 초소형이라 분포가 과하게 극단적
(99.98%) — 실 서비스 규모의 분포는 이보다 덜 확실할 것이고, 그래서
confidence 게이트([workflow.ts](../src/workflow.ts))가 존재한다.

## 재현

```bash
git clone https://github.com/vinnylarouge/jevlike && cd jevlike
uv venv && uv pip install -e '.[dev]'
# 이 레포의 scripts/make_ticket_data.py로 data/tickets/ 생성 후
uv run jevlike-train data/tickets/train.jsonl --validation data/tickets/validation.jsonl \
  --output runs/tickets.pt --context-tokens 384 --epochs 60
uv run jevlike-eval runs/tickets.pt data/tickets/test.jsonl
uv run jevlike-predict runs/tickets.pt --context "제목: 로그인이 이상해요
본문: 결제 페이지에 들어가려면 로그인을 해야 하는데 자꾸 에러가 나요." \
  --option billing --option technical --option account
```

## 다음 단계 (남은 숙제)

- TypeSafe 플레이그라운드에서 진짜 Jev에 같은 티켓을 물어보고
  이 표에 네 번째 열("Jev 실측") 추가하기
- `examples/real-jev.ts` + `src/providers/requesty.ts`는 이미 대기 중 —
  API 키만 있으면 목업/로컬/진짜 3중 비교가 완성된다

→ [06. jevlike 해부로 돌아가기](06-jevlike-open-implementation.md)
