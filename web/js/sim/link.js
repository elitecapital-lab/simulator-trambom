// Kênh truyền thông gateway <-> máy chủ – tương đương link.py
import { stream } from './rng.js';

export class Link {
  constructor(cfg, seedOffset = 0) {
    this.latency = cfg.link.latency_s; this.loss = cfg.link.loss_prob;
    this.rng = stream(cfg.sim.seed + seedOffset, 3);
    this.up = true; this.to_server = []; this.to_gateway = [];
    this.bytes_up = 0; this.bytes_down = 0; this.msgs_up = 0; this.msgs_down = 0; this.down_events = [];
  }
  setUp(up, t) {
    if (this.up && !up) { this.to_server = []; this.to_gateway = []; this.down_events.push([t, null]); }
    else if (!this.up && up && this.down_events.length) this.down_events[this.down_events.length - 1][1] = t;
    this.up = up;
  }
  _lost() { return this.loss > 0.0 && this.rng.random() < this.loss; }
  sendUp(t, msg, nbytes) {
    if (!this.up || this._lost()) return false;
    this.to_server.push([t + this.latency, msg]); this.bytes_up += nbytes; this.msgs_up += 1; return true;
  }
  sendDown(t, msg, nbytes) {
    if (!this.up || this._lost()) return false;
    this.to_gateway.push([t + this.latency, msg]); this.bytes_down += nbytes; this.msgs_down += 1; return true;
  }
  static _due(queue, t) {
    if (!queue.length) return [[], queue];
    const due = []; const rest = [];
    for (const item of queue) (item[0] <= t + 1e-9 ? due : rest).push(item);
    return [due.map((x) => x[1]), rest];
  }
  recvServer(t) { const [d, r] = Link._due(this.to_server, t); this.to_server = r; return d; }
  recvGateway(t) { const [d, r] = Link._due(this.to_gateway, t); this.to_gateway = r; return d; }
}
