// Mẫu kịch bản của học viên cho trình soạn thảo trên web (JavaScript).
export const TEMPLATE_TODO = `// BÀI TẬP CƠ BẢN – kịch bản điều khiển theo ngưỡng (JavaScript)
// Gateway gọi hàm dieuKhien mỗi chu kỳ quét 1 s. Lớp an toàn vẫn luôn chạy sau hàm này.
// inp: { t, hour, dow, dt, p (bar, có thể null), q (m³/h), level (m), q_in, cl, ntu, ph,
//        online, pumps: [{running, f, fault, run_s, starts}], duty, tte_h,
//        du_bao(giây), do_lech(giây), du_bao_max(giây) }   ← 3 hàm dự báo cho bài nâng cao
// mem: đối tượng lưu trạng thái của bạn giữa các chu kỳ
// params: tham số kịch bản, ví dụ params.pressure.kp_hz_per_bar
// Trả về { n_pumps, f_ref (Hz), p_set (bar), order: [bơm chính, bơm phụ] }
function dieuKhien(inp, mem, params) {
  const pr = params.pressure, lv = params.level, st = params.staging;
  const q = inp.q ?? 0;

  // TODO 1: áp đặt theo lưu lượng P_set = p_crit_target + dz + r_est·Q², kẹp [p_set_min, p_set_max]
  let pSet = 3.0;

  // TODO 2: dừng bơm khi mức < lv.stop_m, chạy lại khi > lv.restart_m (lưu cờ trong mem)

  // TODO 3: bộ điều khiển PI: e = pSet − p; f = kp·e + I; I += kp·dt/ti·e (chống bão hòa)
  let f = 40;

  // TODO 4: ghép bơm thứ hai khi f ≥ st.f_on_hz và áp thiếu > st.err_on_bar trong st.t_on_s giây
  let n = 1;

  // TODO 5: luân phiên bơm theo params.alternation.runtime_h (hoặc dùng inp.duty)
  const order = [0, 1];

  return { n_pumps: n, f_ref: f, p_set: pSet, order };
}`;

export const TEMPLATE_SOLUTION = `// LỜI GIẢI MẪU – kịch bản theo ngưỡng (tương đương student/loi_giai/kich_ban_nguong_mau.py)
function dieuKhien(inp, mem, params) {
  const pr = params.pressure, lv = params.level, st = params.staging;
  const F_MIN = 25, F_MAX = 50, dt = inp.dt, q = inp.q ?? 0, level = inp.level;
  const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
  let pSet = clamp(pr.p_crit_target_bar + pr.dz_bar + pr.r_est * q * q, pr.p_set_min_bar, pr.p_set_max_bar);
  if (!inp.online) pSet += params.offline.margin_bar;
  if (level < lv.conserve_m) pSet = Math.max(pSet + lv.conserve_delta_bar, Math.min(pSet, lv.p_set_conserve_min_bar));
  const order = [inp.duty, 1 - inp.duty];
  if (mem.dung) { if (level > lv.restart_m) mem.dung = false; }
  else if (level < lv.stop_m) mem.dung = true;
  if (mem.dung) { mem.I = F_MIN; mem.n = 0; return { n_pumps: 0, f_ref: 0, p_set: pSet, order }; }
  let n = mem.n || 1;
  if (!mem.n) mem.I = 35;
  if (inp.p === null) return { n_pumps: n, f_ref: 40, p_set: pSet, order };
  const e = pSet - inp.p, kp = pr.kp_hz_per_bar;
  let I = mem.I ?? 35;
  const u = kp * e + I;
  if (!((u >= F_MAX && e > 0) || (u <= F_MIN && e < 0))) I += kp * dt / pr.ti_s * e;
  mem.I = I = clamp(I, F_MIN - 10, F_MAX + 10);
  const f = clamp(kp * e + I, F_MIN, F_MAX);
  if (n === 1) {
    mem.tOn = (f >= st.f_on_hz && e > st.err_on_bar) ? (mem.tOn || 0) + dt : 0;
    if (mem.tOn >= st.t_on_s) { n = 2; mem.tOn = 0; }
  } else {
    mem.tOff = f <= st.f_off_hz ? (mem.tOff || 0) + dt : 0;
    if (mem.tOff >= st.t_off_s) { n = 1; mem.tOff = 0; }
  }
  mem.n = n;
  return { n_pumps: n, f_ref: f, p_set: pSet, order };
}`;
