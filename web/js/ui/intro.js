// Hỗ trợ học tập trước khi bắt đầu: sơ đồ khối hệ thống, bảng ngưỡng tham số, chọn mức độ & kịch bản.
const n1 = (v, d = 1) => Number(v).toFixed(d).replace('.', ',');

export function thresholdRows(cfg) {
  const s = cfg.safety, p = cfg.script.params, sv = cfg.service, g = cfg.gateway, pm = cfg.pump_model;
  return [
    ['Áp lực', null],
    ['Áp lực tối thiểu tại điểm bất lợi', `≥ ${n1(sv.p_crit_min_bar)} bar`, 'Chất lượng dịch vụ: ≈14 m cột nước (nhà 2 tầng)'],
    ['Áp lực tối đa đầu ra trạm', `≤ ${n1(sv.p_out_max_bar)} bar`, 'Giới hạn áp lực tự do mạng lưới ≈40 m'],
    ['Áp lực đặt theo lưu lượng P_set(Q)', `${n1(p.pressure.p_set_min_bar)}–${n1(p.pressure.p_set_max_bar)} bar`, `P_set = ${n1(p.pressure.p_crit_target_bar, 2)} + ${n1(p.pressure.dz_bar, 2)} + ${p.pressure.r_est}·Q²`],
    ['Cảnh báo áp thấp đầu ra', `< ${n1(s.p_low_bar)} bar (${s.p_low_delay_s} s)`, 'Cảnh báo'],
    ['Nghi vỡ ống chính', `P < ${n1(s.p_lowlow_bar)} bar & Q > ${s.burst_q_m3h} m³/h`, `Báo động khẩn sau ${s.burst_delay_s} s`],
    ['Áp cao – giới hạn tần số', `> ${n1(s.p_high_bar)} bar`, `Hạ trần tần số ${n1(s.p_limiter_down_hz_s)} Hz/s (dùng PT-102)`],
    ['Áp rất cao – cắt bơm', `> ${n1(s.p_highhigh_bar)} bar (${s.p_hh_delay_s} s)`, `Chạy lại sau ${s.p_trip_restart_s} s; ${s.p_trip_max_per_h} lần/giờ → khóa`],
    ['Van an toàn cơ khí PSV-01', `${n1(cfg.relief_valve.set_bar)} bar`, 'Độc lập với điện tử'],
    ['Mức nước bể T-01', null],
    ['Van phao đóng / tràn', `${n1(cfg.inlet.float_close_m)} m / ${n1(cfg.tank.overflow_m)} m`, 'Cơ khí'],
    ['Mức thấp – giảm áp tiết kiệm', `< ${n1(p.level.conserve_m)} m`, `P_set ${n1(p.level.conserve_delta_bar)} bar, không dưới ${n1(p.level.p_set_conserve_min_bar)} bar`],
    ['Mức dừng bơm (kịch bản)', `< ${n1(p.level.stop_m)} m · chạy lại > ${n1(p.level.restart_m)} m`, 'Chống chạy khô, có trễ'],
    ['Mức rất thấp (lớp an toàn)', `< ${n1(s.level_ll_m)} m · chạy lại > ${n1(s.level_ll_restart_m)} m`, `Phao cứng LSLL-101: ${n1(s.float_lsll_m, 2)} m`],
    ['Chất lượng nước (QCVN 01-1:2018/BYT)', null],
    ['Clo dư tự do', `cảnh báo <${n1(s.cl_warn_low)} / >${n1(s.cl_warn_high)} · dừng <${n1(s.cl_trip_low)} / >${n1(s.cl_trip_high)} mg/L`, `Quy chuẩn 0,2–1,0 mg/L; xác nhận ${s.cl_delay_s} s`],
    ['Độ đục', `cảnh báo > ${n1(s.ntu_warn)} · dừng > ${n1(s.ntu_trip)} NTU`, `Quy chuẩn ≤ 2 NTU; xác nhận ${s.ntu_delay_s} s`],
    ['pH', `cảnh báo <${n1(s.ph_warn_low)} / >${n1(s.ph_warn_high)} · dừng <${n1(s.ph_trip_low)} / >${n1(s.ph_trip_high)}`, `Quy chuẩn 6,0–8,5; xác nhận ${s.ph_delay_s} s`],
    ['Đặt lại sau dừng an toàn', `ổn định ${s.quality_reset_hold_s / 60} phút`, 'Chỉ khi có lệnh đặt lại từ trung tâm hoặc HMI'],
    ['Truyền thông & tự vận hành', null],
    ['Nhịp tim / gói đo xa', `${g.heartbeat_s} s / ${g.telemetry_s} s`, 'MQTT QoS 1'],
    ['Thời gian trễ phát hiện mất mạng', `${g.offline_after_s} s`, 'Không nhận ACK nhịp tim'],
    ['Biên áp lực khi mất mạng', `+${n1(p.offline.margin_bar)} bar · sau ${p.offline.long_after_h} h: +${n1(p.offline.long_margin_bar)} bar`, 'Bù cho mất giám sát trung tâm'],
    ['Thời hạn lệnh ghi đè từ xa', `${p.offline.override_ttl_s / 60} phút`, 'Hết hạn → quay về kịch bản đã lưu'],
    ['Bộ đệm lưu-và-chuyển', `${g.buffer_capacity} bản ghi (${g.buffer_capacity * g.telemetry_s / 3600} h)`, `Nén khi đầy ${g.buffer_compact_at * 100} %; phát lại ${g.replay_rate_per_s} bản ghi/s`],
    ['Giám sát kịch bản mới', `${g.script_watch_s / 60} phút`, `Quay lui nếu lệch áp > ${n1(g.script_rollback_err_bar)} bar quá ${g.script_rollback_err_frac * 100} % thời gian`],
    ['Thiết bị', null],
    ['Dải tần số biến tần', `${pm.f_min_hz}–${pm.f_max_hz} Hz`, `Tăng/giảm ${n1(pm.ramp_hz_s)} Hz/s`],
    ['Giới hạn khởi động bơm', `${s.max_starts_per_h} lần/giờ · nghỉ ≥ ${s.min_off_s} s`, 'Bảo vệ động cơ (ưu tiên hơn tiết kiệm điện)'],
  ];
}

function box(x, y, w, h, title, lines, cls = '') {
  const t = lines.map((l, i) => `<text x="${x + 10}" y="${y + 38 + i * 15}" class="bd-s">${l}</text>`).join('');
  return `<g class="bd-box ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/><text x="${x + 10}" y="${y + 20}" class="bd-t">${title}</text>${t}</g>`;
}
function layer(y, h, name) {
  return `<g class="bd-layer"><rect x="6" y="${y}" width="1088" height="${h}" rx="8"/><text x="18" y="${y + 18}" class="bd-l">${name}</text></g>`;
}
function arrow(x1, y1, x2, y2, label = '', cls = '') {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return `<g class="bd-arr ${cls}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)"/>${label ? `<text x="${mx + 6}" y="${my + 4}" class="bd-s">${label}</text>` : ''}</g>`;
}

export function blockDiagramSVG() {
  const s = [];
  s.push(`<svg viewBox="0 0 1100 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sơ đồ khối hệ thống điều khiển trạm bơm tăng áp">`);
  s.push(`<style>
    .bd-layer rect{fill:var(--surface-2);stroke:var(--line)} .bd-l{font:700 13px var(--f-label);letter-spacing:.06em;text-transform:uppercase;fill:var(--muted)}
    .bd-box rect{fill:var(--surface);stroke:var(--ink-2);stroke-width:1.2} .bd-t{font:600 13px var(--f-body);fill:var(--ink)} .bd-s{font:11.5px var(--f-body);fill:var(--ink-2)}
    .bd-box.key rect{stroke:var(--accent);stroke-width:2} .bd-box.safe rect{stroke:var(--critical);stroke-width:2}
    .bd-arr line{stroke:var(--ink-2);stroke-width:1.4} .bd-arr.dash line{stroke-dasharray:5 4} .bd-arr.water line{stroke:var(--water);stroke-width:3}
    #ah path{fill:var(--ink-2)}
  </style><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>`);
  s.push(layer(8, 108, '5 · Tích hợp mạng lưới'));
  s.push(box(150, 30, 210, 76, 'Các trạm ST-02 … ST-04', ['cùng giao thức, cùng máy chủ', 'tổng điện năng toàn mạng']));
  s.push(box(380, 30, 230, 76, 'Logger áp điểm bất lợi', ['NB-IoT, chu kỳ 15 phút', 'hiệu chỉnh r_est từ trung tâm']));
  s.push(box(630, 30, 220, 76, 'Bảng điều khiển trung tâm', ['lưu lượng, áp lực các trạm', 'cảnh báo tập trung, NRW']));
  s.push(box(870, 30, 210, 76, 'GIS / mô hình thủy lực', ['EPANET/WNTR (mở rộng)', 'kế hoạch cắt nước']));
  s.push(layer(124, 118, '4 · Máy chủ điều hành'));
  s.push(box(150, 148, 165, 84, 'MQTT broker', ['QoS 1, phiên bền', 'LWT “offline”', 'bản tin retained']));
  s.push(box(330, 148, 170, 84, 'Kho kịch bản', ['có phiên bản, hash', 'kiểm tra giới hạn', 'đánh dấu bản lỗi'], 'key'));
  s.push(box(515, 148, 170, 84, 'Hàng đợi lệnh', ['id chống trùng', 'thời hạn (TTL)', 'gửi lại đến khi ACK']));
  s.push(box(700, 148, 180, 84, 'Đồng bộ & hợp nhất', ['hợp nhất 3 chiều', 'bảo thủ cho tham số an toàn', 'chống trùng theo seq'], 'key'));
  s.push(box(895, 148, 185, 84, 'CSDL chuỗi thời gian', ['REST API /api/v1/…', 'báo cáo KPI, so sánh', 'cảnh báo tập trung']));
  s.push(layer(250, 76, '3 · Truyền thông'));
  s.push(box(150, 268, 300, 50, '4G/LTE · MQTT trên TLS 1.2', []));
  s.push(box(470, 268, 260, 50, 'Nhịp tim 10 s · mất mạng sau 60 s', []));
  s.push(box(750, 268, 330, 50, 'SMS dự phòng cho báo động nghiêm trọng', []));
  s.push(layer(334, 140, '2 · Edge gateway GW-01 · mini PC MPC-01 (tủ mới CP-02, có UPS)'));
  s.push(box(150, 358, 175, 104, 'Thu thập & kiểm tra', ['chu kỳ 1 s, lọc nhiễu', 'phạm vi 4–20 mA (NE43)', 'kẹt, lệch PT-101/PT-102', 'biểu quyết với mô hình bơm']));
  s.push(box(340, 358, 185, 104, 'LỚP AN TOÀN', ['ưu tiên cao nhất', 'cắt áp cao, chống chạy khô', 'dừng an toàn chất lượng', 'giới hạn số lần khởi động'], 'safe'));
  s.push(box(540, 358, 185, 104, 'Kịch bản điều khiển', ['áp đặt theo lưu lượng + PI', 'ghép/tách & luân phiên bơm', 'cơ bản: ngưỡng', 'nâng cao: dự báo 168 h'], 'key'));
  s.push(box(740, 358, 160, 104, 'Bộ đệm lưu-và-chuyển', ['4.320 bản ghi + nén', 'sự kiện không bao giờ xóa', 'phát lại 20 bản ghi/s']));
  s.push(box(915, 358, 165, 104, 'Khi mất kết nối', ['tự vận hành bằng kịch bản', 'đã lưu, biên áp +0,1 bar', 'lệnh ghi đè có thời hạn', 'giám sát & quay lui']));
  s.push(layer(482, 150, '1 · Cảm biến, chấp hành & quá trình'));
  s.push(box(150, 506, 250, 112, 'Cảm biến', ['PT-101 / PT-102 áp lực đầu ra', 'FT-101 lưu lượng ra · FT-100 vào', 'LT-101 mức siêu âm · LSLL-101 phao', 'AIT-201 clo · AIT-202 đục · AIT-203 pH', 'PI-101/102 đồng hồ kim tại chỗ']));
  s.push(box(415, 506, 200, 112, 'Chấp hành (tủ CP-01)', ['VFD-01/02 hiện có → P-01/P-02', 'PID nội dự phòng (watchdog)', 'MV-02 van điện đầu ra', 'VX-01 xả đáy · EM-101']));
  s.push(box(630, 506, 450, 112, 'Quá trình thủy lực', ['Ống cấp thành phố → van phao FV-01 → bể T-01 (192 m³)', '→ P-01/P-02 (biến tần, song song) → bình tích áp HT-01', '→ FT-101 → MV-02 → mạng lưới DMA-A (≈2.400 người)', '→ bồn mái hộ dân; rò rỉ Q = C·P^1,18']));
  s.push(arrow(275, 506, 237, 462, 'số đo'));
  s.push(arrow(632, 462, 515, 506, 'lệnh'));
  s.push(arrow(820, 358, 820, 318, 'đo xa · sự kiện'));
  s.push(arrow(600, 268, 600, 232, ''));
  s.push(arrow(450, 232, 450, 268, 'lệnh · kịch bản', 'dash'));
  s.push(arrow(740, 148, 740, 106, 'REST / WebSocket'));
  s.push(arrow(495, 106, 495, 148, 'dữ liệu logger', 'dash'));
  s.push(arrow(860, 584, 1060, 584, '', 'water'));
  s.push(`<text x="18" y="548" class="bd-s">Nét đứt: từ trung</text><text x="18" y="563" class="bd-s">tâm xuống trạm.</text><text x="18" y="584" class="bd-s">Nét xanh đậm:</text><text x="18" y="599" class="bd-s">dòng nước.</text>`);
  s.push('</svg>');
  return s.join('');
}

export class Intro {
  constructor(root, cfg, scenarios, onStart) {
    this.root = root; this.cfg = cfg; this.scenarios = scenarios; this.onStart = onStart; this.step = 0;
    root.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="intro-title">
        <header><h2 id="intro-title">Trước khi bắt đầu</h2><div class="spacer"></div>
          <nav class="steps" aria-label="Các bước"><button data-s="0">1 · Sơ đồ khối</button><button data-s="1">2 · Bảng ngưỡng</button><button data-s="2">3 · Mức độ &amp; kịch bản</button></nav></header>
        <div class="body">
          <section data-p="0">
            <div class="prose"><p>Hệ thống gồm năm tầng. <b>Edge gateway</b> tự ra quyết định tại trạm; máy chủ chỉ giám sát, phát hành kịch bản và gửi lệnh có thời hạn. Khi mất mạng, gateway vẫn chạy kịch bản đã lưu và lưu đệm dữ liệu. <b>Lớp an toàn</b> luôn đứng sau kịch bản và có quyền ghi đè.</p></div>
            <div class="diagram">${blockDiagramSVG()}</div>
          </section>
          <section data-p="1" hidden>
            <div class="prose"><p>Các ngưỡng được đọc trực tiếp từ <code>config/station.json</code> – cùng file với mô phỏng Python. Thứ tự ưu tiên khi xung đột: an toàn người &amp; thiết bị → chất lượng nước → áp lực dịch vụ → tuổi thọ thiết bị → điện năng.</p></div>
            <div class="thr-wrap"><table class="thr"><thead><tr><th>Tham số</th><th>Ngưỡng</th><th>Ghi chú</th></tr></thead><tbody>${thresholdRows(this.cfg).map((r) => (r[1] === null ? `<tr class="grp"><td colspan="3">${r[0]}</td></tr>` : `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`)).join('')}</tbody></table></div>
          </section>
          <section data-p="2" hidden>
            <div class="choose">
              <div>
                <span class="lbl">Mức độ kịch bản điều khiển</span>
                <div class="lvl" style="margin-top:6px">
                  <label><input type="radio" name="lvl" value="basic" checked> <b>Cơ bản – điều khiển theo ngưỡng</b><small>Áp đặt theo lưu lượng, PI, ghép bơm khi bơm chính max tần số, dừng theo mức nước. Bài tập: hoàn thiện kịch bản theo ngưỡng (student/kich_ban_nguong.py hoặc mục Kịch bản trên thanh chức năng bên phải).</small></label>
                  <label><input type="radio" name="lvl" value="advanced"> <b>Nâng cao – điều khiển dự báo</b><small>Mẫu sử dụng 168 giờ (giờ × ngày) học trực tuyến, biên áp theo độ bất định, bù trước, ghép bơm theo mô hình, dự báo cạn bể, phát hiện rò rỉ ban đêm, biểu quyết cảm biến áp.</small></label>
                </div>
                <p class="note">Phương án lịch cố định luôn chạy song song với cùng nhu cầu và sự cố để so sánh trực tiếp.</p>
              </div>
              <div><span class="lbl">Kịch bản thí nghiệm</span><div class="sclist" style="margin-top:6px">${this.scenarios.map((s, i) => `<label><input type="radio" name="sc" value="${s.id}" ${i === 0 ? 'checked' : ''}><span><b>${s.name}</b><span class="mchips">${s.modes.map((m) => `<span class="chip off">(${m})</span>`).join('')}</span><br><small>${s.summary}</small></span></label>`).join('')}</div></div>
            </div>
          </section>
        </div>
        <footer><button class="btn" data-act="prev">Quay lại</button><button class="btn" data-act="next">Tiếp</button><button class="btn primary" data-act="start">Bắt đầu mô phỏng</button></footer>
      </div>`;
    root.querySelectorAll('.steps button').forEach((b) => b.addEventListener('click', () => this.go(+b.dataset.s)));
    root.querySelector('[data-act=prev]').addEventListener('click', () => this.go(Math.max(0, this.step - 1)));
    root.querySelector('[data-act=next]').addEventListener('click', () => this.go(Math.min(2, this.step + 1)));
    root.querySelector('[data-act=start]').addEventListener('click', () => {
      const lvl = root.querySelector('input[name=lvl]:checked').value;
      const sc = root.querySelector('input[name=sc]:checked').value;
      this.hide();
      this.onStart(sc, lvl);
    });
    root.addEventListener('click', (e) => { if (e.target === root && this.started) this.hide(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden && this.started) this.hide(); });
    this.go(0);
  }
  go(i) {
    this.step = i;
    this.root.querySelectorAll('[data-p]').forEach((p) => { p.hidden = +p.dataset.p !== i; });
    this.root.querySelectorAll('.steps button').forEach((b) => b.classList.toggle('on', +b.dataset.s === i));
  }
  show(step = 0, sc = null, lvl = null) {
    if (sc) { const r = this.root.querySelector(`input[name=sc][value="${sc}"]`); if (r) r.checked = true; }
    if (lvl) { const r = this.root.querySelector(`input[name=lvl][value="${lvl}"]`); if (r) r.checked = true; }
    this.go(step); this.root.hidden = false;
  }
  hide() { this.root.hidden = true; this.started = true; }
}
