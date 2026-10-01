# 명령어

- 타입 검사: `npm run build` (tsc --noEmit)
- 테스트: `npm test` (전체) / 단일 파일: `npm test -- tests/calibration.test.ts`
- 목업 데모: `npm run example`
- 진짜 Jev 호출: `REQUESTY_API_KEY=... npm run example:real` (키 없으면 스킵됨)

# 문서 규칙

- README과 docs/는 전부 한국어로 쓴다
- 성능·정확도 수치를 말할 때는 항상 재현 방법과 함께 기록한다 (실측 없는 수치 금지)

# 코드 규칙

- `MockDecisionClient`는 결정론적이어야 한다 — 랜덤을 넣지 않는다 (테스트가 깨짐)
- `src/providers/requesty.ts`의 테스트는 네트워크 없이 순수 변환만 검증한다; 실제 HTTP 호출은 `examples/real-jev.ts`에서만
- 확률 분포 계산은 `src/calibration.ts`의 도구를 재사용한다
