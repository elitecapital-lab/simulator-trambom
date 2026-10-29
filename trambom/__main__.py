"""Giao diện dòng lệnh:  python -m trambom <lệnh> [tùy chọn]

Lệnh:
  list                         liệt kê kịch bản thí nghiệm
  thresholds                   in bảng ngưỡng tham số
  run S4 [--level advanced]    chạy một kịch bản, in bảng so sánh, lưu biểu đồ
  compare [--scenarios ...]    chạy nhiều kịch bản ở cả hai mức, xuất báo cáo Markdown + PNG
  network [--hours 24]         mô phỏng 4 trạm trong mạng lưới, in bảng điều hành tổng quát
  check-student <file.py>      chấm kịch bản theo ngưỡng của học viên
  web [--port 8000]            chạy máy chủ web tĩnh cho bản mô phỏng 3D
"""
import argparse
import os
import sys
import time

from .engine import load_config, load_scenarios, run_scenario
from .report import comms_table_md, kpi_table_md, plot_result, save_json, timeline_md
from .util import ROOT


def cmd_list(args):
    for sc in load_scenarios().values():
        print("%-4s %-62s %4d h  chế độ %s" % (sc["id"], sc["name"], sc["duration_h"], ",".join(sc["modes"])))


def threshold_rows(cfg):
    s = cfg["safety"]
    p = cfg["script"]["params"]
    sv = cfg["service"]
    g = cfg["gateway"]
    return [
        ("Áp lực tối thiểu tại điểm bất lợi", "≥ %.1f bar" % sv["p_crit_min_bar"], "Chất lượng dịch vụ (≈14 m cột nước, nhà 2 tầng)"),
        ("Áp lực tối đa đầu ra trạm", "≤ %.1f bar" % sv["p_out_max_bar"], "Giới hạn áp lực tự do mạng lưới (40 m)"),
        ("Áp lực đặt đầu ra P_set(Q)", "%.1f–%.1f bar" % (p["pressure"]["p_set_min_bar"], p["pressure"]["p_set_max_bar"]),
         "P_set = %.2f + %.2f + %.5f·Q²" % (p["pressure"]["p_crit_target_bar"], p["pressure"]["dz_bar"], p["pressure"]["r_est"])),
        ("Cảnh báo áp thấp đầu ra", "< %.1f bar (%.0f s)" % (s["p_low_bar"], s["p_low_delay_s"]), "Cảnh báo"),
        ("Nghi vỡ ống", "P < %.1f bar và Q > %.0f m³/h (%.0f s)" % (s["p_lowlow_bar"], s["burst_q_m3h"], s["burst_delay_s"]), "Báo động khẩn"),
        ("Áp cao – giới hạn tần số", "> %.1f bar" % s["p_high_bar"], "Giảm trần tần số %.1f Hz/s" % s["p_limiter_down_hz_s"]),
        ("Áp rất cao – cắt bơm", "> %.1f bar (%.0f s)" % (s["p_highhigh_bar"], s["p_hh_delay_s"]), "Tự chạy lại sau %.0f s; %d lần/giờ → khóa" % (s["p_trip_restart_s"], s["p_trip_max_per_h"])),
        ("Van an toàn cơ khí PSV-01", "%.1f bar" % cfg["relief_valve"]["set_bar"], "Độc lập với điện tử"),
        ("Mức nước: van phao đóng", "%.1f m" % cfg["inlet"]["float_close_m"], "Tràn ở %.1f m" % cfg["tank"]["overflow_m"]),
        ("Mức thấp – giảm áp tiết kiệm", "< %.1f m" % p["level"]["conserve_m"], "P_set %+.1f bar (không dưới %.1f bar)" % (p["level"]["conserve_delta_bar"], p["level"]["p_set_conserve_min_bar"])),
        ("Mức dừng bơm (kịch bản)", "< %.1f m, chạy lại > %.1f m" % (p["level"]["stop_m"], p["level"]["restart_m"]), "Chống chạy khô"),
        ("Mức rất thấp (lớp an toàn)", "< %.1f m, chạy lại > %.1f m" % (s["level_ll_m"], s["level_ll_restart_m"]), "Phao cứng LSLL %.2f m" % s["float_lsll_m"]),
        ("Clo dư tự do", "cảnh báo < %.1f / > %.1f; dừng < %.1f / > %.1f mg/L" % (s["cl_warn_low"], s["cl_warn_high"], s["cl_trip_low"], s["cl_trip_high"]), "QCVN 01-1:2018/BYT: 0,2–1,0 mg/L; xác nhận %.0f s" % s["cl_delay_s"]),
        ("Độ đục", "cảnh báo > %.1f; dừng > %.1f NTU" % (s["ntu_warn"], s["ntu_trip"]), "QCVN: ≤ 2 NTU; xác nhận %.0f s" % s["ntu_delay_s"]),
        ("pH", "cảnh báo < %.1f / > %.1f; dừng < %.1f / > %.1f" % (s["ph_warn_low"], s["ph_warn_high"], s["ph_trip_low"], s["ph_trip_high"]), "QCVN: 6,0–8,5; xác nhận %.0f s" % s["ph_delay_s"]),
        ("Thời gian trễ phát hiện mất mạng", "%.0f s" % g["offline_after_s"], "Nhịp tim %.0f s" % g["heartbeat_s"]),
        ("Biên áp lực khi mất mạng", "+%.1f bar (> %.0f h: +%.1f bar)" % (p["offline"]["margin_bar"], p["offline"]["long_after_h"], p["offline"]["long_margin_bar"]), "Bù cho việc mất giám sát trung tâm"),
        ("Thời hạn lệnh ghi đè từ xa", "%.0f phút" % (p["offline"]["override_ttl_s"] / 60), "Hết hạn → quay về kịch bản đã lưu"),
        ("Bộ đệm lưu-và-chuyển", "%d bản ghi (%.0f h)" % (g["buffer_capacity"], g["buffer_capacity"] * g["telemetry_s"] / 3600), "Nén khi đầy %.0f %%" % (100 * g["buffer_compact_at"])),
        ("Giới hạn khởi động bơm", "%d lần/giờ, nghỉ ≥ %.0f s" % (s["max_starts_per_h"], s["min_off_s"]), "Bảo vệ động cơ"),
    ]


def cmd_thresholds(args):
    for name, val, note in threshold_rows(load_config()):
        print("%-36s %-48s %s" % (name, val, note))


def _progress(frac, el):
    sys.stderr.write("\r  %5.1f %%  (%.0f s)" % (100 * frac, el))
    sys.stderr.flush()


def cmd_run(args):
    custom = None
    if args.script:
        from .student import load_custom
        custom = load_custom(args.script)
    sc = load_scenarios()[args.scenario]
    print("Chạy %s – mức %s ..." % (sc["name"], args.level))
    t0 = time.time()
    r = run_scenario(args.scenario, args.level, args.hours, args.dt, custom, progress=_progress)
    sys.stderr.write("\n")
    print("Xong sau %.1f s\n" % (time.time() - t0))
    basic = r if args.level == "basic" else None
    adv = r if args.level == "advanced" else None
    print(kpi_table_md(r["fixed"], basic["smart"] if basic else None, adv["smart"] if adv else None))
    print()
    print(timeline_md(r, 60))
    out = args.out or os.path.join(ROOT, "out")
    os.makedirs(out, exist_ok=True)
    png = os.path.join(out, "%s_%s.png" % (args.scenario, args.level))
    plot_result(r, None, png, sc["name"] + " – mức " + args.level)
    save_json({"smart": r["smart"], "fixed": r["fixed"], "sync": r["server"]["sync_log"]}, os.path.join(out, "%s_%s.json" % (args.scenario, args.level)))
    print("\nĐã lưu biểu đồ: %s" % png)


def _one(job):
    sc_id, level, dt = job
    return (sc_id, level, run_scenario(sc_id, level, None, dt))


def cmd_compare(args):
    from concurrent.futures import ProcessPoolExecutor
    scs = load_scenarios()
    ids = args.scenarios.split(",") if args.scenarios else [k for k in scs if k != "S0"]
    jobs = [(i, lv, args.dt) for i in ids for lv in ("basic", "advanced")]
    out = args.out or os.path.join(ROOT, "docs", "ket-qua")
    os.makedirs(os.path.join(out, "img"), exist_ok=True)
    t0 = time.time()
    results = {}
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        for sc_id, level, r in ex.map(_one, jobs):
            results[(sc_id, level)] = r
            print("  xong %s/%s sau %.0f s" % (sc_id, level, time.time() - t0))
    md = ["# Kết quả so sánh: lịch cố định và điều khiển thông minh", "",
          "Tệp này được sinh tự động bởi `python -m trambom compare` (dt = %s s, hạt giống ngẫu nhiên %d). "
          "Ba phương án chạy song song với **cùng một chuỗi nhu cầu, nguồn nước và sự cố**." % (args.dt or load_config()["sim"]["dt_s"], load_config()["sim"]["seed"]), ""]
    summary = {}
    for sc_id in ids:
        sc = scs[sc_id]
        rb, ra = results[(sc_id, "basic")], results[(sc_id, "advanced")]
        md += ["## %s" % sc["name"], "", sc["summary"], "", kpi_table_md(rb["fixed"], rb["smart"], ra["smart"]), ""]
        if any(e["type"].startswith("link") for e in sc["events"]):
            md += [comms_table_md(rb["smart"], ra["smart"]), ""]
            for rep in ra["server"]["sync_log"]:
                if rep["conflicts"] or rep["decisions"]:
                    md += ["Hợp nhất kịch bản khi đồng bộ (mức nâng cao):", "",
                           "| Tham số | Gốc | Máy chủ | Tại chỗ | Kết quả | Quy tắc |", "|---|---:|---:|---:|---:|---|"]
                    for c in rep["conflicts"]:
                        md.append("| `%s` | %s | %s | %s | **%s** | %s |" % (c["path"], c["base"], c["server"], c["local"], c["result"], c["rule"]))
                    for d in rep["decisions"]:
                        md.append("| `%s` | | | | %s | chỉ %s thay đổi |" % (d["path"], d["value"], d["from"]))
                    md.append("")
        img = "img/%s.png" % sc_id
        plot_result(rb, ra, os.path.join(out, img), sc["name"])
        md += ["![%s](%s)" % (sc["name"], img), "", "<details><summary>Diễn biến chính (mức nâng cao)</summary>", "",
               timeline_md(ra, 45), "", "</details>", ""]
        summary[sc_id] = {"fixed": rb["fixed"], "basic": rb["smart"], "advanced": ra["smart"]}
    with open(os.path.join(out, "README.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    save_json(summary, os.path.join(out, "kpi.json"))
    print("Đã ghi %s (%.0f s)" % (os.path.join(out, "README.md"), time.time() - t0))


def cmd_network(args):
    from .network import NetworkSim
    print("Mô phỏng %d trạm trong %.0f h ..." % (len(load_config()["stations"]), args.hours))
    n = NetworkSim(level=args.level)
    s = n.run(args.hours)
    print("| Trạm | kWh thông minh | kWh lịch cố định | Tiết kiệm | Áp ngoài dải (phút) thông minh / cố định | Rò rỉ m³ |")
    print("|---|---:|---:|---:|---:|---:|")
    for r in s["stations"]:
        a, b = r["smart"], r["fixed"]
        print("| %s | %.1f | %.1f | %.0f %% | %.0f / %.0f | %.1f |" % (r["name"], a["energy_kwh"], b["energy_kwh"],
              100 * (1 - a["energy_kwh"] / b["energy_kwh"]), a["t_out_min"], b["t_out_min"], a["leak_m3"]))
    t = s["totals"]
    print("| **Toàn mạng** | **%.1f** | **%.1f** | **%.0f %%** | %.0f / %.0f | %.1f |" % (t["smart_kwh"], t["fixed_kwh"],
          100 * (1 - t["smart_kwh"] / t["fixed_kwh"]), t["smart_out_min"], t["fixed_out_min"], t["smart_leak"]))
    print("\nTỷ lệ rò rỉ / nước cấp vào mạng: thông minh %.1f %%, lịch cố định %.1f %%" % (t["smart_nrw_pct"], t["fixed_nrw_pct"]))
    print("Cảnh báo tập trung đã ghi nhận: %d" % t["central_alarms"])


def cmd_check(args):
    from .student import check
    print("Chấm kịch bản %s ..." % args.file)
    res = check(args.file, args.quick)
    ok = 0
    for name, passed, detail in res:
        ok += passed
        print("  [%s] %-70s %s" % ("ĐẠT" if passed else "CHƯA", name, detail))
    print("\nKết quả: %d/%d tiêu chí đạt" % (ok, len(res)))
    return 0 if ok == len(res) else 1


def cmd_web(args):
    import functools
    import http.server
    import webbrowser
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    url = "http://127.0.0.1:%d/web/" % args.port
    print("Mở trình duyệt tại %s  (Ctrl+C để dừng)" % url)
    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m trambom", description="Mô phỏng trạm bơm tăng áp thông minh")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("list")
    sub.add_parser("thresholds")
    p = sub.add_parser("run")
    p.add_argument("scenario")
    p.add_argument("--level", choices=["basic", "advanced"], default="basic")
    p.add_argument("--hours", type=float)
    p.add_argument("--dt", type=float)
    p.add_argument("--script", help="file kịch bản học viên (hàm dieu_khien)")
    p.add_argument("--out")
    p = sub.add_parser("compare")
    p.add_argument("--scenarios")
    p.add_argument("--dt", type=float)
    p.add_argument("--jobs", type=int, default=4)
    p.add_argument("--out")
    p = sub.add_parser("network")
    p.add_argument("--hours", type=float, default=24)
    p.add_argument("--level", choices=["basic", "advanced"], default="basic")
    p = sub.add_parser("check-student")
    p.add_argument("file")
    p.add_argument("--quick", action="store_true")
    p = sub.add_parser("web")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-browser", action="store_true")
    args = ap.parse_args(argv)
    fn = {"list": cmd_list, "thresholds": cmd_thresholds, "run": cmd_run, "compare": cmd_compare, "network": cmd_network,
          "check-student": cmd_check, "web": cmd_web}.get(args.cmd)
    if fn is None:
        ap.print_help()
        return 0
    return fn(args) or 0


if __name__ == "__main__":
    sys.exit(main())
