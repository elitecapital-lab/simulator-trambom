"""Mô hình vật lý trạm bơm tăng áp.

Trạng thái liên tục:
    level   – mực nước bể chứa T-01 (m)
    p       – áp lực ống đẩy chung (bar g), tích trữ trong bình tích áp HT-01 + độ đàn hồi ống
    p_net   – áp lực đầu mạng lưới (sau van MV-02)
    backlog – thiếu hụt quy đổi của bồn mái các hộ dân (m3)
    cl, ntu, ph – chất lượng nước trong bể (trộn đều)

Phương trình áp lực giải bằng Euler lùi (ổn định vô điều kiện) với Newton có chặn:
    S(p_{n+1}) - S(p_n) = dt * [ Q_bom(p) - Q_mang(p) - Q_xa(p) ]
trong đó S(p) là thể tích nước trữ trong bình tích áp và đường ống.
"""
import math

from .util import clamp


class PumpUnit:
    """Một tổ bơm ly tâm + biến tần (VFD)."""

    def __init__(self, tag, pm):
        self.tag = tag
        self.pm = pm
        self.cmd_run = False
        self.f_ref = 0.0
        self.f = 0.0
        self.running = False
        self.fault = False
        self.throttle_k = 0.0
        self.starts = 0
        self.run_s = 0.0
        self.energy_kwh = 0.0
        self.dry_run_s = 0.0
        self.q = 0.0
        self.h = 0.0
        self.kw = 0.0
        self.amps = 0.0
        self.gauge = 0.0

    def update_drive(self, dt):
        pm = self.pm
        want = self.cmd_run and not self.fault
        if want:
            if not self.running:
                self.running = True
                self.starts += 1
            target = clamp(self.f_ref, pm["f_min_hz"], pm["f_max_hz"])
            step = pm["ramp_hz_s"] * dt
            if self.f < target:
                self.f = min(target, self.f + step)
            else:
                self.f = max(target, self.f - step)
        else:
            if self.running:
                rate = 10.0 if self.fault else pm["ramp_hz_s"]
                self.f = max(0.0, self.f - rate * dt)
                if self.f <= 0.0:
                    self.running = False


class Plant:
    def __init__(self, cfg, station=None):
        station = station or {}
        self.cfg = cfg
        c = cfg["constants"]
        self.rho = c["rho"]
        self.g = c["g"]
        self.m_per_bar = 1.0e5 / (self.rho * self.g)
        self.tank = cfg["tank"]
        self.inlet = cfg["inlet"]
        self.pm = cfg["pump_model"]
        self.ht = cfg["hydro_tank"]
        self.rv = cfg["relief_valve"]
        self.net = dict(cfg["network"])
        if "dz_crit_m" in station:
            self.net["dz_crit_m"] = station["dz_crit_m"]
        self.dz_bar = self.net["dz_crit_m"] / self.m_per_bar
        self.qual = cfg["quality"]
        self.pumps = [PumpUnit(tag, self.pm) for tag in cfg["pumps"]]
        # trạng thái
        self.level = self.tank["level_init_m"]
        self.p = 2.2
        self.p_net = 2.2
        self.backlog = 0.0
        self.cl = self.qual["cl_init_mgl"]
        self.ntu = self.qual["ntu_init"]
        self.ph = self.qual["ph_init"]
        self.outlet_cmd = True
        self.outlet_frac = 1.0
        self.drain_open = False
        self.inlet_enabled = True
        self.q_prev = 0.0
        # đầu ra mỗi bước
        self.q_in = 0.0
        self.q_out = 0.0
        self.q_req = 0.0
        self.q_served = 0.0
        self.q_leak = 0.0
        self.q_burst = 0.0
        self.q_relief = 0.0
        self.q_drain = 0.0
        self.q_pumps = 0.0
        self.p_crit = 0.0
        self.kw = 0.0
        self.unserved_m3 = 0.0
        self.overflow_m3 = 0.0
        self.q_cons = 0.0
        self.newton_iters = 0

    # ---------- bình tích áp ----------
    def storage(self, p):
        v = self.ht["c_pipe_m3_per_bar"] * p
        p0 = self.ht["precharge_bar"]
        if p > p0:
            v += self.ht["volume_m3"] * (1.0 - (p0 + 1.0) / (p + 1.0))
        return v

    def storage_deriv(self, p):
        d = self.ht["c_pipe_m3_per_bar"]
        p0 = self.ht["precharge_bar"]
        if p > p0:
            d += self.ht["volume_m3"] * (p0 + 1.0) / ((p + 1.0) * (p + 1.0))
        return d

    def ht_water_l(self):
        p0 = self.ht["precharge_bar"]
        if self.p <= p0:
            return 0.0
        return 1000.0 * self.ht["volume_m3"] * (1.0 - (p0 + 1.0) / (self.p + 1.0))

    def suction_psi(self):
        """Hệ số suy giảm cột áp khi mực nước thấp (xoáy, lọt khí – chạy khô)."""
        lv = self.tank["vortex_level_m"]
        la = self.tank["air_level_m"]
        if self.level >= lv:
            return 1.0
        return clamp((self.level - la) / (lv - la), 0.0, 1.0)

    # ---------- một bước tích phân ----------
    def step(self, dt, dist):
        pm = self.pm
        net = self.net
        mpb = self.m_per_bar
        dt_h = dt / 3600.0
        for pu in self.pumps:
            pu.update_drive(dt)

        # van đầu ra (hành trình tuyến tính)
        travel = self.cfg["outlet_valve"]["travel_s"]
        target = 1.0 if self.outlet_cmd else 0.0
        if self.outlet_frac < target:
            self.outlet_frac = min(target, self.outlet_frac + dt / travel)
        elif self.outlet_frac > target:
            self.outlet_frac = max(target, self.outlet_frac - dt / travel)
        vfrac = self.outlet_frac

        # nhu cầu yêu cầu = tiêu thụ + bù bồn mái
        self.q_cons = dist["q_cons"]
        refill = min(net["rooftop_refill_max_m3h"], self.backlog / net["rooftop_tau_h"])
        q_req = self.q_cons + refill
        self.q_req = q_req
        qb_nom = dist["q_burst"]

        psi = self.suction_psi()
        h_suc = self.level + self.tank["z_suction_m"]
        h0 = pm["h0_m"]
        kk = pm["k_m_per_m3h2"]
        loss = net["r_bar_per_m3h2"] * self.q_prev * self.q_prev
        dz = self.dz_bar
        p_zero = net["p_zero_bar"]
        p_full = net["p_full_bar"]
        leak_c = net["leak_c"]
        n1 = net["leak_n1"]
        rv_set = self.rv["set_bar"]
        rv_k = self.rv["k_m3h_per_bar"]
        active = []
        for pu in self.pumps:
            if pu.running and pu.f > 0.0:
                s = pu.f / pm["f_rated_hz"]
                active.append((psi * h0 * s * s, kk + pu.throttle_k))

        s_old = self.storage(self.p)

        def residual(p):
            qp = 0.0
            dqp = 0.0
            h_req = p * mpb - h_suc
            for hav, kt in active:
                dh = hav - h_req
                if dh > 0.0:
                    q = math.sqrt(dh / kt)
                    qp += q
                    dqp += mpb / (2.0 * kt * max(q, 0.05))
            qo = 0.0
            dqo = 0.0
            if vfrac > 0.0:
                pc = p - dz - loss
                if pc <= p_zero:
                    qd = 0.0
                    dqd = 0.0
                elif pc >= p_full:
                    qd = q_req
                    dqd = 0.0
                else:
                    r = (pc - p_zero) / (p_full - p_zero)
                    sq = math.sqrt(r)
                    qd = q_req * sq
                    dqd = q_req * 0.5 / (max(sq, 0.02) * (p_full - p_zero))
                if pc > 0.0:
                    pa = 0.5 * (p + pc)
                    dpa = 1.0
                else:
                    pa = 0.5 * p
                    dpa = 0.5
                if pa > 0.0:
                    ql = leak_c * pa ** n1
                    dql = leak_c * n1 * max(pa, 0.01) ** (n1 - 1.0) * dpa
                    qbb = qb_nom * math.sqrt(pa / 2.0)
                    dqb = qb_nom * 0.25 / math.sqrt(2.0 * max(pa, 0.01) / 2.0) * dpa if qb_nom > 0 else 0.0
                else:
                    ql = dql = qbb = dqb = 0.0
                qo = vfrac * (qd + ql + qbb)
                dqo = vfrac * (dqd + dql + dqb)
            qr = 0.0
            dqr = 0.0
            if p > rv_set:
                qr = rv_k * (p - rv_set)
                dqr = rv_k
            g = self.storage(p) - s_old - dt_h * (qp - qo - qr)
            gp = self.storage_deriv(p) + dt_h * (dqp + dqo + dqr)
            return g, gp

        lo, hi = -0.9, 12.0
        p = self.p
        it = 0
        while it < 60:
            it += 1
            g, gp = residual(p)
            if abs(g) < 1e-11:
                break
            if g > 0.0:
                hi = p
            else:
                lo = p
            pn = p - g / gp
            if not (lo < pn < hi):
                pn = 0.5 * (lo + hi)
            if abs(pn - p) < 1e-10:
                p = pn
                break
            p = pn
        self.newton_iters = it
        self.p = p

        # ---- dòng chảy tại nghiệm ----
        h_req = p * mpb - h_suc
        q_pumps = 0.0
        for pu in self.pumps:
            if pu.running and pu.f > 0.0:
                s = pu.f / pm["f_rated_hz"]
                hav = psi * h0 * s * s
                kt = kk + pu.throttle_k
                dh = hav - h_req
                q = math.sqrt(dh / kt) if dh > 0.0 else 0.0
                pu.q = q
                pu.h = max(0.0, hav - kk * q * q)
                x = clamp(q / (s * pm["q_bep_m3h"]), 0.0, 1.8)
                p_shaft = self.rho * self.g * pu.h * s * (pm["q_bep_m3h"] / 3600.0) / (pm["eta_max"] * (2.0 - x))
                pu.kw = p_shaft / pm["eta_motor_vfd"] / 1000.0 + pm["standby_w"] / 1000.0
                pu.run_s += dt
                if self.level < self.tank["vortex_level_m"]:
                    pu.dry_run_s += dt
                pu.gauge = (pu.h - pu.throttle_k * q * q + h_suc) / mpb
                q_pumps += q
            else:
                pu.q = 0.0
                pu.h = 0.0
                pu.kw = pm["standby_w"] / 1000.0
                pu.gauge = h_suc / mpb
            pu.amps = pu.kw * 1000.0 / (math.sqrt(3.0) * pm["voltage_v"] * pm["cos_phi"])
            pu.energy_kwh += pu.kw * dt_h
        self.q_pumps = q_pumps

        if vfrac > 0.0:
            pc = p - dz - loss
            if pc <= p_zero:
                qd = 0.0
            elif pc >= p_full:
                qd = q_req
            else:
                qd = q_req * math.sqrt((pc - p_zero) / (p_full - p_zero))
            pa = 0.5 * (p + pc) if pc > 0.0 else 0.5 * p
            pa = max(pa, 0.0)
            ql = leak_c * pa ** n1 if pa > 0 else 0.0
            qbb = qb_nom * math.sqrt(pa / 2.0) if pa > 0 else 0.0
        else:
            qd = ql = qbb = 0.0
        self.q_served = vfrac * qd
        self.q_leak = vfrac * ql
        self.q_burst = vfrac * qbb
        self.q_out = self.q_served + self.q_leak + self.q_burst
        self.q_relief = rv_k * (p - rv_set) if p > rv_set else 0.0
        self.q_prev = self.q_out

        # áp lực đầu mạng và điểm bất lợi
        if vfrac >= 0.999:
            self.p_net = p
        else:
            a = 1.0 - math.exp(-dt / net["net_decay_s"])
            self.p_net += (vfrac * p - self.p_net) * a
        self.p_crit = self.p_net - dz - net["r_bar_per_m3h2"] * self.q_out * self.q_out

        # ---- bể chứa ----
        A = self.tank["area_m2"]
        band = self.inlet["float_band_m"]
        frac_in = clamp((self.inlet["float_close_m"] - self.level) / band, 0.0, 1.0)
        self.q_in = self.inlet["q_max_m3h"] * dist["supply"] * frac_in if self.inlet_enabled else 0.0
        self.q_drain = self.tank["drain_q_m3h"] if (self.drain_open and self.level > 0.05) else 0.0
        dv = (self.q_in + self.q_relief - q_pumps - self.q_drain) * dt_h
        self.level += dv / A
        if self.level > self.tank["overflow_m"]:
            self.overflow_m3 += (self.level - self.tank["overflow_m"]) * A
            self.level = self.tank["overflow_m"]
        if self.level < 0.0:
            self.level = 0.0

        # ---- chất lượng nước (bể trộn đều) ----
        vol = A * max(self.level, 0.1)
        a_in = self.q_in / 3600.0 / vol
        kb = self.qual["cl_decay_per_day"] / 86400.0
        ks = self.qual["ntu_settle_per_h"] / 3600.0
        ent = 0.0
        el = self.qual["entrain_level_m"]
        if q_pumps > 0.0 and self.level < el:
            ent = self.qual["entrain_ntu_per_h"] / 3600.0 * (el - self.level) / el * min(1.0, q_pumps / 30.0)
        self.cl += dt * (a_in * (dist["cl_in"] - self.cl) - kb * self.cl)
        self.ntu += dt * (a_in * (dist["ntu_in"] - self.ntu) - ks * (self.ntu - self.qual["ntu_floor"]) + ent)
        self.ph += dt * a_in * (dist["ph_in"] - self.ph)

        # ---- bồn mái hộ dân ----
        self.backlog += (self.q_cons - self.q_served) * dt_h
        if self.backlog < 0.0:
            self.backlog = 0.0
        cap = net["rooftop_capacity_m3"]
        if self.backlog > cap:
            self.unserved_m3 += self.backlog - cap
            self.backlog = cap

        self.kw = sum(pu.kw for pu in self.pumps)

    def volume(self):
        return self.level * self.tank["area_m2"]
