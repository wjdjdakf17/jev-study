"""
한국어 지원 티켓 데이터셋 생성기 — jev-study의 목업 세계관을
실제 학습 데이터로 옮긴다.

출력: data/tickets/{train,validation,test}.jsonl
형식: {"context": "...", "options": ["billing","technical","account"], "label": 0}
  label: 0=billing, 1=technical, 2=account

설계:
  - 팀별 명확 티켓 (키워드 강한 신호) — train/val/test 전체
  - 애매한 티켓 (두 팀 신호 혼합) — test에만. 셔플드 컨트롤과 함께
    "진짜 학습했는가"를 가리는 시험지 역할.
"""
import json
import random
from pathlib import Path

rng = random.Random(42)

BILLING = [
    ("결제가 두 번 청구됐습니다", "어제 구독 결제가 카드에 두 번 들어갔어요. 환불 부탁드립니다."),
    ("환불 요청드립니다", "지난달 결제한 구독을 취소하고 환불받고 싶습니다."),
    ("카드 결제 오류", "결제를 시도하면 카드 승인이 계속 실패합니다."),
    ("청구 내역이 이상해요", "영수증에 안 쓴 내용이 청구됐습니다. 결제 내역 확인 부탁드려요."),
    ("구독 결제 문의", "구독 요금이 인상됐나요? 이번 달 청구 금액이 다릅니다."),
    ("영수증 재발급 부탁드려요", "회사 경비 처리용으로 결제 영수증이 필요합니다."),
    ("환불 언제 받을 수 있나요", "3일 전에 환불 요청했는데 아직 입금이 안 됐습니다."),
    ("결제 수단 변경하고 싶어요", "카드를 새로 발급했는데 결제 수단 등록이 안 됩니다."),
]

TECHNICAL = [
    ("앱이 켜지지 않아요", "실행하면 시작 화면에서 바로 꺼집니다. 재설치해도 같은 증상입니다."),
    ("로그인이 안 돼요", "비밀번호를 입력하면 로그인 에러가 뜹니다. 웹에서는 됩니다."),
    ("화면이 하얗게 나옵니다", "특정 메뉴에 들어가면 빈 화면이 뜹니다. 버그인 것 같아요."),
    ("동기화가 안 됩니다", "모바일에서 저장한 내용이 데스크톱에 반영되지 않아요."),
    ("로딩이 너무 느려요", "목록을 열 때마다 수 분씩 로딩 중에 걸립니다."),
    ("푸시 알림이 안 와요", "알림 설정을 켰는데도 아무 알림이 오지 않습니다."),
    ("파일 업로드 실패", "이미지를 올리면 업로드 에러가 나면서 실패합니다."),
    ("검색이 작동하지 않아요", "검색어를 넣으면 결과가 아무것도 나오지 않습니다."),
]

ACCOUNT = [
    ("비밀번호를 잊었어요", "가입한 이메일로 재설정 메일이 오지 않습니다."),
    ("계정 이메일을 변경하고 싶어요", "회사를 옮겨서 로그인 이메일을 바꿔야 합니다."),
    ("회원 탈퇴는 어떻게 하나요", "계정을 삭제하고 싶습니다. 절차를 알려주세요."),
    ("프로필 수정이 안 저장돼요", "계정 설정에서 이름을 바꿔도 저장이 안 됩니다."),
    ("다른 기기에서 로그인 관리", "분실한 폰에서 로그인된 계정을 원격으로 로그아웃하고 싶어요."),
    ("계정이 갑자기 잠겼습니다", "로그인을 시도하니 계정 잠금 안내가 뜹니다."),
    ("이메일 인증 메일이 안 와요", "가입했는데 인증 메일을 받지 못했습니다."),
    ("개인정보 조회 요청", "내 계정에 어떤 정보가 저장돼 있는지 확인하고 싶습니다."),
]

# 애매한 티켓 — 두 팀 신호가 섞임. label은 지배적 신호 기준.
AMBIGUOUS = [
    ("결제 페이지에서 로그인 에러가 나요", "결제하려고 들어갔는데 로그인하라고 하고, 하면 에러가 납니다.", 1),
    ("구독 결제 후 프리미엄이 안 열려요", "결제는 됐는데 프리미엄 기능에 접근하면 오류가 뜹니다.", 1),
    ("환불하면 계정도 삭제되나요?", "환불을 요청하려는데 계정은 유지하고 싶습니다.", 0),
    ("계정 삭제하면 진행 중인 환불은?", "탈퇴하면 처리 중인 환불 요청도 취소되는지 궁금합니다.", 2),
    ("새 계정 만들었는데 결제 내역이 이어지나요?", "기존 계정을 탈퇴하고 새로 가입했습니다. 구독 결제는 어떻게 되나요?", 2),
]

def rows_for(team_idx: int, source: list, count: int) -> list[dict]:
    picked = [source[i % len(source)] for i in range(count)]
    return [
        {"context": f"제목: {s}\n본문: {b}", "options": ["billing", "technical", "account"], "label": team_idx}
        for s, b in picked
    ]

def main() -> None:
    # 팀별 train 24 / val 4 / clear-test 4 + 애매 5
    train: list[dict] = []
    val: list[dict] = []
    test: list[dict] = []

    for idx, source in enumerate([BILLING, TECHNICAL, ACCOUNT]):
        pool = source * 4  # 반복해서 다양 조합
        rng.shuffle(pool)
        train += rows_for(idx, pool, 24)
        val += rows_for(idx, pool[24:], 4)
        test += rows_for(idx, pool[28:], 4)

    test += [
        {"context": f"제목: {s}\n본문: {b}", "options": ["billing", "technical", "account"], "label": lbl}
        for s, b, lbl in AMBIGUOUS
    ]

    rng.shuffle(train)
    rng.shuffle(val)
    rng.shuffle(test)

    out = Path("data/tickets")
    out.mkdir(parents=True, exist_ok=True)
    for name, data in [("train", train), ("validation", val), ("test", test)]:
        path = out / f"{name}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for row in data:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"{path}: {len(data)}행")

if __name__ == "__main__":
    main()
