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
      }
    ],
    "steps": [
      "로그인 · 승인",
      "수불 넣기",
      "정리 · 열 연결",
      "요율 · 예상 출고",
      "월말 재고 굴리기",
      "발주 리스트"
    ]
  }
};
