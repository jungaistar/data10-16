// 로그인 설정 — 이 파일 한 곳만 바꾸면 된다(생성: data10-00/scripts/apply-auth-kit.mjs, 대문 문구 출처 docs/plan.json).
// 내 Supabase 로 옮길 때: url · anonKey 를 내 프로젝트 값으로, 카카오를 설정하지 않았으면 kakao: false. 안내 = docs/내_깃허브로_옮기기.md
// prefix 는 supabase/auth.sql 의 표 이름 앞부분과 같아야 한다.
window.AUTH_CONFIG = {
  "url": "https://hcmgdztsgjvzcyxyayaj.supabase.co",
  "anonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjbWdkenRzZ2p2emN5eHlheWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzU4ODcsImV4cCI6MjA4NzAxMTg4N30.gznaPzY1l8qDAPsEyYNR9KS7f7VqS3xaw-_2HTSwSZw",
  "prefix": "data1016",
  "kakao": true,
  "idleMinutes": 30,
  "localBypass": true,
  "site": {
    "title": "원/부자재 미결 방지 사전 관리",
    "summary": "입출고 수불 엑셀과 생산계획으로 자재(강종·규격)별 대당 출고 요율과 차 3개월 예상 출고·월말 재고를 굴려, MOQ·리드타임을 반영한 색 구분 발주 리스트와 장기·불용 재고 지표를 만드는 브라우저 도구입니다.",
    "course": "현장 데이터 디지털화 전문가과정 · 2차수",
    "features": [
      {
        "name": "수불 엑셀 가져오기",
        "desc": "수불 현황 · 생산대수 · 발주 기준 시트를 알아서 가르고, 머리행 · 월 열 · 기준월을 찾아 열을 연결합니다."
      },
      {
        "name": "차 3개월 예상 출고",
        "desc": "직전 출고와 생산실적 대수로 대당 요율을 내고, 차 3개월 생산계획을 곱해 달마다 예상 출고를 냅니다."
      },
      {
        "name": "색 구분 발주 리스트",
        "desc": "월말 재고를 굴려 빨강 · 주황 · 노랑 · 초록 우선순위, 발주 마감, MOQ 를 반영한 권장 발주량을 냅니다."
      },
      {
        "name": "장기 · 불용 지표",
        "desc": "재고 개월수 · 마지막 출고 · 출고 감소 · MOQ 과다로 미결 반대쪽 위험인 장기 · 불용 재고를 미리 봅니다."
      },
      {
        "name": "AI 프롬프트",
        "desc": "계산된 사실만 담고 공급사 · 자재코드는 「공급사1」「자재2」 같은 별칭으로 가립니다. AI 답은 원래 이름으로 되돌립니다."
      },
      {
        "name": "보고서",
        "desc": "총괄 · 계산 기준 · 발주 리스트 · 강종별 부족량 · 장기 · 불용 · AI 의견 — 인쇄/PDF · Word · 엑셀 · 글자 복사."
      }
    ],
    "steps": [
      "로그인 · 승인",
      "수불 넣기",
      "정리 · 열 연결",
      "요율 · 예상 출고",
      "월말 재고 굴리기",
      "발주 리스트"
    ],
    "flow": [
      {
        "step": "로그인 · 승인",
        "desc": "가입 · 사용 신청 뒤 관리자가 승인하면 도구가 열림"
      },
      {
        "step": "수불 넣기",
        "desc": "수불 현황 · 생산대수 · 발주 기준 시트(한 파일 또는 여러 파일)"
      },
      {
        "step": "정리 · 열 연결",
        "desc": "시트 종류 · 머리행 · 월 열 · 기준월 찾기, 합계 줄 제외, 같은 자재 합침"
      },
      {
        "step": "요율 · 예상 출고",
        "desc": "대당 출고 요율 × 차 3개월 생산계획 대수"
      },
      {
        "step": "월말 재고 굴리기",
        "desc": "현재고 + 발주잔량 − 예상 출고, 안전재고 · 결품 판정"
      },
      {
        "step": "발주 리스트",
        "desc": "우선순위 색 · 발주 마감 · MOQ · 발주단위 반영 권장 발주량"
      }
    ],
    "goals": [
      "수불 엑셀을 넣으면 규격별 차 3개월 예상 출고 → 월별 기초재고 → 부족량 → 발주 리스트가 같은 기준으로 나옵니다.",
      "발주 우선순위를 색(빨강 긴급 · 주황 이번 달 · 노랑 예정 · 초록 충분)으로 나눠 이번 달 무엇부터 발주할지 바로 보입니다.",
      "MOQ · 리드타임 · 발주단위 · 안전재고를 자재마다 반영해 발주 마감과 권장 발주량을 냅니다."
    ],
    "screen": "docs/img/screen.png",
    "plan": "plan.html",
    "home": true,
    "landing": {
      "company": {
        "name": "건화",
        "en": "KUNHWA"
      },
      "colors": {
        "navy": "#0d2a5c",
        "navy2": "#081d42",
        "brand": "#1a4fa0",
        "brandDark": "#123a78",
        "accent": "#ff9a8f"
      }
    }
  }
};
