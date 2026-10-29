// Điều khiển thiết bị ngay trong cảnh 3D (bảng điều khiển nổi gắn vào bơm/van, chế độ TAY tại chỗ).
// Bản khung: giao diện lớp dùng bởi main.js – phần hiện thực nằm ở các phiên bản sau.
export class Control3D {
  constructor(app, host) { this.app = app; this.host = host; }
  /** Thiết bị điều khiển được không (bơm, biến tần, van MV-02). */
  handles(tag) { return false; }
  /** Mở bảng điều khiển nổi cho thiết bị; trả về false nếu không điều khiển được (main.js mở thẻ thông tin). */
  open(tag) { return false; }
  close() {}
  /** Chế độ TAY tại chỗ đang bật (theo quyền điều khiển thực của gateway). */
  get manualMode() { return Boolean(this.app.st && !this.app.st.gw_dead && this.app.st.gw.controlSrc() !== 'auto'); }
  /** Bật/tắt chế độ TAY tại chỗ từ cảnh 3D. */
  setManualMode(on) {}
  /** Gọi mỗi 250 ms: cập nhật số liệu, trạng thái nút. */
  update(force = false) {}
  /** Gọi mỗi khung hình 3D: đặt lại vị trí các bảng nổi theo camera. */
  frame() {}
}
