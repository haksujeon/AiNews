// 모달이 열린 상태에서 다른 경로(로고, 통계 등)로 소프트 이동하면
// @modal 슬롯이 이전 상태(모달)를 유지하는 parallel route 특성이 있다.
// 모든 비-가로채기 경로에서 슬롯을 비워 모달이 닫히게 한다.
export default function ModalCatchAll() {
  return null;
}
