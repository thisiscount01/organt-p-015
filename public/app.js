'use strict';

// ─── Design Tokens (단일 출처 — JS 상수, CSS vars와 쌍) ──────────────────────
const TOKEN = Object.freeze({
  // Powerup border colors (V-3 색 테이블)
  PU_FIRE_RATE:    '#00e5ff',
  PU_PIERCE:       '#00e5ff',
  PU_MOVE_SPEED:   '#00e5ff',
  PU_SHIELD:       '#4082ff',
  PU_SPREAD:       '#ffab00',
  PU_HEAL:         '#ff4081',
  PU_BURST:        '#aa00ff',
  // Enemy
  ENEMY_HP1:       '#ff4757',
  ENEMY_HP2:       '#ff6b35',
  ENEMY_HP3:       '#c44dff',
  CLR_ZIGZAG:      '#a8ff3e',
  CLR_FLANKER:     '#ff3eb8',
  CLR_ELITE:       '#ffd600',
  // Player / UI
  CLR_PRIMARY:     '#00e5ff',
  CLR_ACCENT:      '#ff4081',
  CLR_GOLD:        '#ffd600',
  CLR_BULLET:      '#ffe666',
  CLR_BG:          '#0a0a12',
  CLR_SHIELD_AURA: 'rgba(64,130,255,0.3)',
  CLR_SHIELD_RING: '#4082ff',
  CLR_HIT_FLASH:   'rgba(255,255,255,0.8)',
});

// ─── Event Constants ──────────────────────────────────────────────────────────
const EVENTS = Object.freeze({
  SHOOT:          'SHOOT',
  KILL:           'KILL',
  SCORE_ADD:      'SCORE_ADD',
  XP_ADD:         'XP_ADD',
  WAVE_CLEAR:     'WAVE_CLEAR',
  POWERUP_SELECT: 'POWERUP_SELECT',
  PLAYER_HIT:     'PLAYER_HIT',
});

// ─── Game Constants ───────────────────────────────────────────────────────────
const FIXED_DT           = 1 / 60;
const BULLET_SPEED       = 500;
const BASE_FIRE_CD       = 300;
const FIRE_CD_MIN        = 50;           // V-8: 쿨다운 하한
const PLAYER_SPEED       = 180;
const INVINCIBILITY      = 1500;
const SCORE_PER_KILL     = 100;
const PLAYER_RADIUS      = 14;
const ENEMY_RADIUS       = 13;
const BULLET_RADIUS      = 5;
const SPAWN_MARGIN       = 40;
const HIT_FLASH_DURATION = 80;           // ms — V-1

// Wave formulas
const waveEnemyCount = n => 4 + n * 4;
const waveEnemyHP    = n => n <= 2 ? 1 : n <= 5 ? 2 : 3;
const waveEnemySpeed = n => Math.min(60 + n * 8, 200);

// ─── Enemy Type Definitions (V-5) ────────────────────────────────────────────
const ENEMY_TYPES = Object.freeze({
  chaser:  { radius: ENEMY_RADIUS, colorFn: hp => hp === 1 ? TOKEN.ENEMY_HP1 : hp === 2 ? TOKEN.ENEMY_HP2 : TOKEN.ENEMY_HP3 },
  zigzag:  { radius: 12, color: TOKEN.CLR_ZIGZAG  },
  flanker: { radius: 14, color: TOKEN.CLR_FLANKER },
  elite:   { radius: 16, color: TOKEN.CLR_ELITE   },
});

// ─── Powerup Catalog (7종 — V-3 색 테이블 적용) ──────────────────────────────
const POWERUP_DEFS = [
  {
    id: 'fire_rate', icon: '⚡', name: '연사력 강화', desc: '발사 쿨다운 20% 감소',
    color: TOKEN.PU_FIRE_RATE,
    apply(p) { p.fireCooldown = Math.max(FIRE_CD_MIN, Math.floor(p.fireCooldown * 0.8)); } // V-8
  },
  {
    id: 'pierce', icon: '🔱', name: '관통 +1', desc: '탄이 적을 최대 3마리 관통',
    color: TOKEN.PU_PIERCE,
    apply(p) { p.pierce = Math.min(p.pierce + 1, 3); }
  },
  {
    id: 'move_speed', icon: '💨', name: '이동속도 +15%', desc: '이동 속도 15% 증가',
    color: TOKEN.PU_MOVE_SPEED,
    apply(p) { p.speed *= 1.15; }
  },
  {
    id: 'shield', icon: '🛡️', name: '보호막', desc: '8초간 실드 아우라 활성화',
    color: TOKEN.PU_SHIELD,
    apply(p) { p.shieldActive = true; p.shieldLeft = 8000; } // V-9
  },
  {
    id: 'spread', icon: '🎯', name: '산탄 확산', desc: '탄이 5방향으로 발사',
    color: TOKEN.PU_SPREAD,
    apply(p) { p.spread = Math.min((p.spread || 0) + 1, 2); }
  },
  {
    id: 'heal', icon: '❤️', name: '체력 회복', desc: '체력 1 회복',
    color: TOKEN.PU_HEAL,
    apply(p) { p.hp = Math.min(p.hp + 1, p.maxHp); }
  },
  {
    id: 'burst', icon: '💥', name: '폭발탄', desc: '처치 시 범위 폭발',
    color: TOKEN.PU_BURST,
    apply(p) { p.burstOnKill = true; }
  },
];

// ─── Audio Engine ─────────────────────────────────────────────────────────────
class AudioEngine {
  constructor() { this._ctx = null; this._ready = false; }

  _init() {
    if (this._ready) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._ready = true;
    } catch (e) { console.warn('Web Audio API unavailable'); }
  }

  _masterGain(vol = 0.18) {
    const g = this._ctx.createGain();
    g.gain.value = vol;
    g.connect(this._ctx.destination);
    return g;
  }

  shoot() {
    this._init(); if (!this._ready) return;
    const ctx = this._ctx;
    const g = this._masterGain(0.12);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.05);
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  }

  kill() {
    this._init(); if (!this._ready) return;
    const ctx = this._ctx;
    const g = this._masterGain(0.22);
    const bufLen = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 800;
    src.connect(filt); filt.connect(g);
    src.start(ctx.currentTime);
  }

  powerup() {
    this._init(); if (!this._ready) return;
    const ctx = this._ctx;
    [261.6, 329.6, 392, 523.2].forEach((f, i) => {
      const g = this._masterGain(0.1);
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = f; osc.connect(g);
      const t = ctx.currentTime + i * 0.055;
      osc.start(t); osc.stop(t + 0.1);
    });
  }

  hit() {
    this._init(); if (!this._ready) return;
    const ctx = this._ctx;
    const g = this._masterGain(0.25);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.08);
    osc.connect(g);
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.08);
  }

  // ── BGM (S-4) ───────────────────────────────────────────────────────────────
  // 적응형 레이어 구조: 드론 + 비트, 웨이브에 따라 강도 증가
  // SFX 대비 볼륨: master 0.55 × 개별 gain = 실효 0.04–0.08 (SFX 0.12–0.25의 1/3 이하)

  startBGM(wave) {
    wave = wave || 1;
    this._init();
    if (!this._ready) return;
    if (this._bgmActive) { this.updateBGMIntensity(wave); return; }

    this._bgmActive        = true;
    this._bgmWave          = wave;
    this._bgmBPM           = 120;
    this._bgmBeat          = 0;
    this._bgmDroneNodes    = [];
    this._bgmScheduleTimer = null;
    this._bgmScheduleAhead = 0.15; // 탭 전환 시 드롭아웃 방지용 선행 스케줄 폭

    const ctx  = this._ctx;
    const init = () => {
      this._bgmMasterGain = ctx.createGain();
      this._bgmMasterGain.gain.setValueAtTime(0, ctx.currentTime);
      this._bgmMasterGain.gain.setTargetAtTime(0.55, ctx.currentTime, 0.7); // fade-in
      this._bgmMasterGain.connect(ctx.destination);
      this._bgmNextBeat = ctx.currentTime + 0.12;
      this._startBGMDroneLayers();
      this._scheduleBGMBeat();
    };

    // AudioContext가 suspended이면 resume 후 기동 (user gesture 이후 보장)
    if (ctx.state === 'suspended') {
      ctx.resume().then(init).catch(() => {});
    } else {
      init();
    }
  }

  _startBGMDroneLayers() {
    const ctx = this._ctx;
    const mg  = this._bgmMasterGain;

    // ① 서브베이스 드론 55 Hz (A1) — SFX 주파수대 아래, 진동감으로 긴장 부여
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = 55;
    const subG = ctx.createGain();
    subG.gain.value = 0.09;
    subOsc.connect(subG);
    subG.connect(mg);
    subOsc.start();
    this._bgmSubGain = subG;
    this._bgmDroneNodes.push(subOsc);

    // ② 대기음 패드: A 단조 트라이어드 (A2 110, C3 130.8, E3 164.8) 삼각파 + LFO 트레몰로
    [[110, 0.18], [130.8, 0.24], [164.8, 0.21]].forEach(([freq, lfoRate]) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const oG = ctx.createGain();
      oG.gain.value = 0.020;

      const lfo  = ctx.createOscillator();
      lfo.type   = 'sine';
      lfo.frequency.value = lfoRate;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.006;
      lfo.connect(lfoG);
      lfoG.connect(oG.gain); // LFO가 gain을 변조 → 유기적 맥동

      osc.connect(oG);
      oG.connect(mg);
      lfo.start();
      osc.start();
      this._bgmDroneNodes.push(osc, lfo);
    });
  }

  _scheduleBGMBeat() {
    if (!this._bgmActive) return;
    const ctx      = this._ctx;
    const stepLen  = (60 / this._bgmBPM) / 4; // 16분음표 길이(초)
    const schedEnd = ctx.currentTime + this._bgmScheduleAhead;

    while (this._bgmNextBeat < schedEnd) {
      const b16 = this._bgmBeat % 16;
      const w   = this._bgmWave;

      // 킥: 1박(0) + 3박(8) — 전 웨이브
      if (b16 === 0 || b16 === 8)
        this._bgmKick(this._bgmNextBeat, w);

      // 스네어: 2박(4) + 4박(12) — 웨이브 2+
      if (w >= 2 && (b16 === 4 || b16 === 12))
        this._bgmSnare(this._bgmNextBeat);

      // 하이햇 8분음표 — 웨이브 3+
      if (w >= 3 && b16 % 2 === 0)
        this._bgmHat(this._bgmNextBeat, false, b16 % 4 === 0 ? 0.022 : 0.015);

      // 16분음표 오프비트 fills — 웨이브 5+
      if (w >= 5 && b16 % 2 === 1)
        this._bgmHat(this._bgmNextBeat, false, 0.010);

      this._bgmNextBeat += stepLen;
      this._bgmBeat++;
    }

    this._bgmScheduleTimer = setTimeout(
      () => this._scheduleBGMBeat(),
      Math.max(16, (this._bgmScheduleAhead * 1000) / 2)
    );
  }

  _bgmKick(time, wave) {
    const ctx = this._ctx;
    const mg  = this._bgmMasterGain;
    const vol = Math.min(0.14, 0.08 + wave * 0.008);

    // 어택 클릭 (1100 Hz 순간 transient)
    const click = ctx.createOscillator();
    click.frequency.value = 1100;
    const cG = ctx.createGain();
    cG.gain.setValueAtTime(0.030, time);
    cG.gain.exponentialRampToValueAtTime(0.0001, time + 0.007);
    click.connect(cG); cG.connect(mg);
    click.start(time); click.stop(time + 0.008);

    // 바디: 160 → 38 Hz 피치 드롭
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.20);
    osc.connect(g); g.connect(mg);
    osc.start(time); osc.stop(time + 0.22);
  }

  _bgmSnare(time) {
    const ctx = this._ctx;
    const sr  = ctx.sampleRate;
    const mg  = this._bgmMasterGain;

    // 노이즈 바디 (bandpass 2 kHz)
    const len = Math.floor(sr * 0.11);
    const buf = ctx.createBuffer(1, len, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 0.8;

    // 톤 바디 195 Hz
    const tone = ctx.createOscillator();
    tone.type = 'sine'; tone.frequency.value = 195;
    const tG = ctx.createGain();
    tG.gain.setValueAtTime(0.025, time);
    tG.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    tone.connect(tG);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.038, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    src.connect(bp); bp.connect(g);
    tG.connect(g); g.connect(mg);
    src.start(time); tone.start(time); tone.stop(time + 0.06);
  }

  _bgmHat(time, open, vol) {
    if (vol === undefined) vol = 0.018;
    const ctx = this._ctx;
    const sr  = ctx.sampleRate;
    const dur = open ? 0.10 : 0.035;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, open ? 1.2 : 3.5);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 9500; // SFX 대역 위
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(hp); hp.connect(g); g.connect(this._bgmMasterGain);
    src.start(time);
  }

  updateBGMIntensity(wave) {
    if (!this._bgmActive || !this._ready) return;
    this._bgmWave = wave;
    // 웨이브 상승 → 서브베이스·마스터 볼륨 완만히 상승
    if (this._bgmSubGain) {
      this._bgmSubGain.gain.setTargetAtTime(
        Math.min(0.13, 0.09 + wave * 0.008), this._ctx.currentTime, 1.5
      );
    }
    if (this._bgmMasterGain) {
      this._bgmMasterGain.gain.setTargetAtTime(
        Math.min(0.70, 0.55 + wave * 0.025), this._ctx.currentTime, 2.0
      );
    }
  }

  stopBGM() {
    if (!this._bgmActive) return;
    this._bgmActive = false;
    if (this._bgmScheduleTimer !== null) {
      clearTimeout(this._bgmScheduleTimer);
      this._bgmScheduleTimer = null;
    }
    // 캡처 후 참조 초기화 → startBGM()이 즉시 재호출 가능
    const oldMaster = this._bgmMasterGain;
    const oldNodes  = this._bgmDroneNodes || [];
    this._bgmMasterGain = null;
    this._bgmDroneNodes = [];
    if (oldMaster && this._ready) {
      oldMaster.gain.setTargetAtTime(0, this._ctx.currentTime, 0.35); // 페이드아웃
      setTimeout(() => {
        oldNodes.forEach(n => {
          try { n.stop(); } catch (_) {}
          try { n.disconnect(); } catch (_) {}
        });
        try { oldMaster.disconnect(); } catch (_) {}
      }, 1800);
    }
  }

  pauseBGM() {
    if (!this._bgmActive || !this._ready) return;
    if (this._bgmScheduleTimer !== null) {
      clearTimeout(this._bgmScheduleTimer);
      this._bgmScheduleTimer = null;
    }
    if (this._bgmMasterGain) {
      this._bgmMasterGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.25);
    }
  }

  resumeBGM() {
    if (!this._bgmActive || !this._ready) return;
    if (this._bgmMasterGain) {
      const target = Math.min(0.70, 0.55 + (this._bgmWave || 1) * 0.025);
      this._bgmMasterGain.gain.setTargetAtTime(target, this._ctx.currentTime, 0.35);
      this._bgmNextBeat = this._ctx.currentTime + 0.1;
      this._bgmBeat = 0;
      this._scheduleBGMBeat();
    }
  }
}

// ─── Particle System ──────────────────────────────────────────────────────────
class Particle {
  constructor() { this.active = false; }
  init(x, y, vx, vy, r, color, life, gravity = 0) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.r = r; this.color = color; this.life = life; this.maxLife = life;
    this.gravity = gravity; this.active = true;
  }
  update(dt) {
    if (!this.active) return;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vy += this.gravity * dt; this.life -= dt;
    if (this.life <= 0) this.active = false;
  }
  draw(ctx) {
    if (!this.active) return;
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * alpha, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class ParticleSystem {
  constructor(poolSize = 600) {
    this._pool = Array.from({ length: poolSize }, () => new Particle());
    this._ptr = 0;
  }
  _alloc() {
    const p = this._pool[this._ptr % this._pool.length];
    this._ptr++;
    return p;
  }
  emit(x, y, color, count, speedMin, speedMax, lifeMin, lifeMax, gravity = 0) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const life  = lifeMin + Math.random() * (lifeMax - lifeMin);
      const r     = 2 + Math.random() * 4;
      const p = this._alloc();
      p.init(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, r, color, life, gravity);
    }
  }
  emitBurst(x, y, color, count = 18) {
    this.emit(x, y, color, count, 60, 240, 0.3, 0.7, 80);
    this.emit(x, y, '#ffffff', Math.ceil(count * 0.3), 20, 80, 0.15, 0.35, 0);
  }
  emitRing(x, y, color) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 160 + Math.random() * 140;
      const life  = 0.25 + Math.random() * 0.20;
      const r     = 2 + Math.random() * 2;
      const p = this._alloc();
      p.init(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, r, color, life, 0);
    }
  }
  // V-2: 비치명 흰 파티클 6개 (수명 0.1–0.25s, 속도 60-140px/s)
  emitHitSparks(x, y) {
    this.emit(x, y, '#ffffff', 6, 60, 140, 0.1, 0.25, 0);
  }
  update(dt) { for (const p of this._pool) if (p.active) p.update(dt); }
  draw(ctx)   { for (const p of this._pool) if (p.active) p.draw(ctx); }
}

// ─── Input ────────────────────────────────────────────────────────────────────
class Input {
  constructor(canvas) {
    this.keys  = {};
    this.mouse = { x: 0, y: 0, down: false };
    this.joystick = { dx: 0, dy: 0, active: false }; // V-7
    this._canvas = canvas;

    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });
    canvas.addEventListener('mousedown', () => { this.mouse.down = true; });
    canvas.addEventListener('mouseup',   () => { this.mouse.down = false; });

    // Touch (aim + shoot — joystick zone blocks its own events)
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const t = e.touches[0];
      this.mouse.x = (t.clientX - rect.left) * (canvas.width / rect.width);
      this.mouse.y = (t.clientY - rect.top)  * (canvas.height / rect.height);
      this.mouse.down = true;
    }, { passive: false });
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const t = e.touches[0];
      this.mouse.x = (t.clientX - rect.left) * (canvas.width / rect.width);
      this.mouse.y = (t.clientY - rect.top)  * (canvas.height / rect.height);
    }, { passive: false });
    canvas.addEventListener('touchend', () => { this.mouse.down = false; });
  }

  isDown(code) { return !!this.keys[code]; }

  get moveDX() {
    let dx = 0;
    if (this.isDown('ArrowLeft')  || this.isDown('KeyA')) dx -= 1;
    if (this.isDown('ArrowRight') || this.isDown('KeyD')) dx += 1;
    if (this.joystick.active) dx += this.joystick.dx;
    return Math.max(-1, Math.min(1, dx));
  }

  get moveDY() {
    let dy = 0;
    if (this.isDown('ArrowUp')   || this.isDown('KeyW')) dy -= 1;
    if (this.isDown('ArrowDown') || this.isDown('KeyS')) dy += 1;
    if (this.joystick.active) dy += this.joystick.dy;
    return Math.max(-1, Math.min(1, dy));
  }
}

// ─── Game ─────────────────────────────────────────────────────────────────────
class Game {
  constructor() {
    this.canvas  = document.getElementById('game-canvas');
    this.ctx     = this.canvas.getContext('2d');
    this.audio   = new AudioEngine();
    this.particles = new ParticleSystem(600);
    this.input   = new Input(this.canvas);

    // UI elements
    this.$screenTitle    = document.getElementById('screen-title');
    this.$screenGame     = document.getElementById('screen-game');
    this.$screenPowerup  = document.getElementById('screen-powerup');
    this.$screenGameover = document.getElementById('screen-gameover');
    this.$waveAnnounce   = document.getElementById('wave-announce');
    this.$waveText       = document.getElementById('wave-announce-text');
    this.$flashOverlay   = document.getElementById('flash-overlay');
    this.$glowOverlay    = document.getElementById('glow-overlay');
    this.$powerupCards   = document.getElementById('powerup-cards');
    this.$waveNum        = document.getElementById('wave-num');
    this.$enemyCount     = document.getElementById('enemy-count');
    this.$scoreVal       = document.getElementById('score-val');
    this.$hpIcons        = [
      document.getElementById('hp-1'),
      document.getElementById('hp-2'),
      document.getElementById('hp-3'),
    ];
    this.$finalScore   = document.getElementById('final-score');
    this.$finalWave    = document.getElementById('final-wave');
    this.$finalKills   = document.getElementById('final-kills');
    this.$bestScoreVal = document.getElementById('best-score-val');
    this.$titleBest    = document.getElementById('title-best');
    this.$titleBestVal = document.getElementById('title-best-val');
    this.$pauseOverlay = document.getElementById('pause-overlay');

    // Button listeners
    document.getElementById('btn-start').addEventListener('click', () => this.startGame());
    document.getElementById('btn-restart').addEventListener('click', () => this.startGame());
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') {
        if (this._state === 'playing') this._pauseGame();
        else if (this._state === 'paused') this._resumeGame();
      }
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this._bestScore = parseInt(localStorage.getItem('bestScore') || '0', 10);
    this._refreshBestDisplay();
    this._stars = this._genStars(120);

    this._shakeX = 0; this._shakeY = 0;
    this._shakeMag = 0; this._shakeDur = 1; this._shakeTime = 0;
    this._rafId = null; this._lastTime = null; this._accum = 0;
    this._state = 'title';

    // V-4: 파워업 등장 추적 (게임 세션당 유지)
    this._powerupSeenTypes = new Set();

    this._setupJoystick(); // V-6, V-7
    this._showScreen('title');
  }

  // ── Joystick Setup (V-6, V-7) ────────────────────────────────────────────
  _setupJoystick() {
    const base   = document.getElementById('joystick-base');
    const handle = document.getElementById('joystick-handle');
    if (!base || !handle) return;

    const MAX_DRAG = 40; // V-7: 핸들 최대 40px 추종
    let activeTouchId = null;

    const getCenter = () => {
      const rect = base.getBoundingClientRect();
      return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    };

    const applyDrag = (clientX, clientY) => {
      const { cx, cy } = getCenter();
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MAX_DRAG) {
        dx = (dx / dist) * MAX_DRAG;
        dy = (dy / dist) * MAX_DRAG;
      }
      handle.style.transform = `translate(${dx}px,${dy}px)`;
      // Normalize to -1..1 for 8-direction input
      this.input.joystick.dx = dx / MAX_DRAG;
      this.input.joystick.dy = dy / MAX_DRAG;
      this.input.joystick.active = true;
    };

    const resetJoystick = () => {
      handle.style.transform = 'translate(0,0)';
      this.input.joystick.dx = 0;
      this.input.joystick.dy = 0;
      this.input.joystick.active = false;
      activeTouchId = null;
    };

    base.addEventListener('touchstart', e => {
      if (activeTouchId !== null) return;
      const t = e.changedTouches[0];
      activeTouchId = t.identifier;
      applyDrag(t.clientX, t.clientY);
    }, { passive: true });

    base.addEventListener('touchmove', e => {
      const t = Array.from(e.changedTouches).find(x => x.identifier === activeTouchId);
      if (!t) return;
      applyDrag(t.clientX, t.clientY);
    }, { passive: true });

    base.addEventListener('touchend', e => {
      const t = Array.from(e.changedTouches).find(x => x.identifier === activeTouchId);
      if (t) resetJoystick();
    }, { passive: true });

    base.addEventListener('touchcancel', resetJoystick, { passive: true });
  }

  // ── Resize ──────────────────────────────────────────────────────────────────
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._W = w; this._H = h;
  }
  get W() { return this._W || window.innerWidth; }
  get H() { return this._H || window.innerHeight; }

  // ── Stars ───────────────────────────────────────────────────────────────────
  _genStars(n) {
    return Array.from({ length: n }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.5 + Math.random() * 1.2,
      a: 0.2 + Math.random() * 0.6,
    }));
  }

  // ── Screen management ───────────────────────────────────────────────────────
  _showScreen(name) {
    const screens = {
      title: this.$screenTitle, game: this.$screenGame,
      powerup: this.$screenPowerup, gameover: this.$screenGameover,
    };
    Object.entries(screens).forEach(([k, el]) => el.classList.toggle('active', k === name));
  }

  // ── Game Start / Reset ──────────────────────────────────────────────────────
  startGame() {
    this.player = {
      x: this.W / 2, y: this.H / 2,
      speed:              PLAYER_SPEED,
      hp: 3, maxHp: 3,
      fireCooldown:       BASE_FIRE_CD,
      fireCooldownLeft:   0,
      pierce:             0,
      spread:             0,   // spread shot
      burstOnKill:        false,
      shieldActive:       false, // V-9
      shieldLeft:         0,
      invincible:         false,
      invincibleLeft:     0,
      angle:              0,
    };
    this.wave = 0; this.score = 0; this.kills = 0;
    this.enemies = []; this.bullets = [];
    this._accum = 0; this._lastTime = null;
    this._powerupSeenTypes = new Set(); // V-4 reset per game
    this.audio.stopBGM(); // 이전 게임 잔여 BGM 정리
    this._state = 'playing';
    this._showScreen('game');
    this.audio.startBGM(1); // S-4: 전투 시작 시 BGM 기동
    this._updateHUD();
    this._startNextWave();
    requestAnimationFrame(ts => { this._lastTime = ts; this._loop(ts); });
  }

  // ── Wave ─────────────────────────────────────────────────────────────────────
  _startNextWave() {
    this.wave++;
    const hp    = waveEnemyHP(this.wave);
    const speed = waveEnemySpeed(this.wave);
    const count = waveEnemyCount(this.wave);
    this._spawnEnemies(count, hp, speed);
    this._announceWave(`WAVE ${this.wave}`);
    this.$waveNum.textContent = this.wave;
    this.audio.updateBGMIntensity(this.wave); // S-4: 웨이브별 BGM 강도 갱신
  }

  _spawnEnemies(count, hp, speed) {
    for (let i = 0; i < count; i++) {
      let x, y;
      const side = Math.floor(Math.random() * 4);
      switch (side) {
        case 0: x = Math.random() * this.W; y = -SPAWN_MARGIN; break;
        case 1: x = this.W + SPAWN_MARGIN;  y = Math.random() * this.H; break;
        case 2: x = Math.random() * this.W; y = this.H + SPAWN_MARGIN;  break;
        case 3: x = -SPAWN_MARGIN;          y = Math.random() * this.H; break;
      }

      // V-5: 웨이브 3부터 신규 적 3종 혼합
      let type = 'chaser';
      if (this.wave >= 3) {
        const r = Math.random();
        if      (r < 0.22) type = 'zigzag';
        else if (r < 0.40) type = 'flanker';
        else if (r < 0.50) type = 'elite';
      }

      const typeDef = ENEMY_TYPES[type];
      const enemyColor = typeDef.colorFn ? typeDef.colorFn(hp) : typeDef.color;
      const enemyHp = type === 'elite' ? Math.max(1, Math.ceil(hp * 1.5)) : hp;

      this.enemies.push({
        x, y,
        hp: enemyHp, maxHp: enemyHp,
        speed: type === 'flanker' ? speed * 1.4 : speed,
        color: enemyColor,
        type,
        radius: typeDef.radius,
        angle: 0,
        wobble: Math.random() * Math.PI * 2,
        flashTimer: 0,  // V-1
        id: Math.random(),
      });
    }
    this.$enemyCount.textContent = this.enemies.length;
  }

  _announceWave(text) {
    this.$waveAnnounce.classList.remove('hidden', 'animating');
    this.$waveText.textContent = text;
    void this.$waveAnnounce.offsetWidth;
    this.$waveAnnounce.classList.add('animating');
    setTimeout(() => {
      this.$waveAnnounce.classList.add('hidden');
      this.$waveAnnounce.classList.remove('animating');
    }, 1700);
  }

  // ── Main Loop ─────────────────────────────────────────────────────────────
  _loop(ts = 0) {
    if (this._state !== 'playing' && this._state !== 'paused') return;
    if (this._state === 'paused') return;
    this._rafId = requestAnimationFrame(t => this._loop(t));
    if (this._lastTime === null) { this._lastTime = ts; return; }
    const elapsed = Math.min((ts - this._lastTime) / 1000, 0.1);
    this._lastTime = ts;
    this._accum += elapsed;
    while (this._accum >= FIXED_DT) {
      this._update(FIXED_DT);
      this._accum -= FIXED_DT;
      if (this._state !== 'playing') break;
    }
    this._render();
  }

  // ── Update ────────────────────────────────────────────────────────────────
  _update(dt) {
    const p = this.player;

    // Player movement (WASD / arrow / joystick V-7)
    const dx = this.input.moveDX;
    const dy = this.input.moveDY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dx !== 0 || dy !== 0) {
      p.x = Math.max(PLAYER_RADIUS, Math.min(this.W - PLAYER_RADIUS, p.x + (dx / len) * p.speed * dt));
      p.y = Math.max(PLAYER_RADIUS, Math.min(this.H - PLAYER_RADIUS, p.y + (dy / len) * p.speed * dt));
    }

    p.angle = Math.atan2(this.input.mouse.y - p.y, this.input.mouse.x - p.x);

    // Invincibility countdown
    if (p.invincible) {
      p.invincibleLeft -= dt * 1000;
      if (p.invincibleLeft <= 0) p.invincible = false;
    }

    // Shield countdown (V-9)
    if (p.shieldActive) {
      p.shieldLeft -= dt * 1000;
      if (p.shieldLeft <= 0) p.shieldActive = false;
    }

    // Fire cooldown + auto-fire
    if (p.fireCooldownLeft > 0) p.fireCooldownLeft -= dt * 1000;
    const wantFire = this.input.mouse.down || this.input.isDown('Space');
    if (wantFire && p.fireCooldownLeft <= 0) this._fireBullet();

    // Move bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -50 || b.x > this.W + 50 || b.y < -50 || b.y > this.H + 50)
        this.bullets.splice(i, 1);
    }

    // Move enemies
    for (const e of this.enemies) {
      const ex = p.x - e.x, ey = p.y - e.y;
      const dist = Math.sqrt(ex * ex + ey * ey) || 1;
      e.x += (ex / dist) * e.speed * dt;
      e.y += (ey / dist) * e.speed * dt;
      e.angle  = Math.atan2(ey, ex);
      e.wobble += dt * 2.5;
      // V-1: 플래시 타이머 감소
      if (e.flashTimer > 0) e.flashTimer -= dt * 1000;
    }

    // Bullet ↔ Enemy collision
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi];
      if (!b) continue;
      for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
        const e = this.enemies[ei];
        const dx2 = b.x - e.x, dy2 = b.y - e.y;
        const dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const hitRadius = BULLET_RADIUS + (e.radius || ENEMY_RADIUS);
        if (dist < hitRadius) {
          e.hp--;
          b.pierced++;
          if (e.hp <= 0) {
            // Lethal (V-2): emitBurst + emitRing
            this.particles.emitBurst(e.x, e.y, e.color, 20);
            this.particles.emitRing(e.x, e.y, e.color);
            if (p.burstOnKill) {
              this.particles.emitBurst(e.x, e.y, e.color, 14);
              this._shake(6, 200);
            }
            this._shake(4, 150);
            this.enemies.splice(ei, 1);
            this.kills++;
            this.score += SCORE_PER_KILL * this.wave;
            this._emit(EVENTS.KILL, { x: e.x, y: e.y });
            this._emit(EVENTS.SCORE_ADD, { amount: SCORE_PER_KILL * this.wave });
            this._emit(EVENTS.XP_ADD, { amount: 10 });
            this.audio.kill();
            this._spawnScorePopup(e.x, e.y, `+${SCORE_PER_KILL * this.wave}`);
            this._updateHUD();
          } else {
            // Non-lethal (V-1, V-2): 흰 플래시 + 흰 파티클 6개
            e.flashTimer = HIT_FLASH_DURATION;
            this.particles.emitHitSparks(e.x, e.y);
          }
          if (b.pierced > p.pierce) { this.bullets.splice(bi, 1); break; }
        }
      }
    }

    // Enemy ↔ Player collision
    if (!p.invincible && !p.shieldActive) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        const dx2 = p.x - e.x, dy2 = p.y - e.y;
        if (Math.sqrt(dx2 * dx2 + dy2 * dy2) < PLAYER_RADIUS + (e.radius || ENEMY_RADIUS)) {
          p.hp--;
          p.invincible = true; p.invincibleLeft = INVINCIBILITY;
          this.audio.hit();
          this._triggerRedFlash();
          this._shake(8, 300);
          this._emit(EVENTS.PLAYER_HIT, { hp: p.hp });
          this._updateHUD();
          if (p.hp <= 0) { this._gameOver(); return; }
          break;
        }
      }
    }

    // Screen shake decay
    if (this._shakeTime > 0) {
      this._shakeTime -= dt * 1000;
      if (this._shakeTime <= 0) {
        this._shakeTime = 0; this._shakeX = 0; this._shakeY = 0; this._shakeMag = 0;
      } else {
        const progress = this._shakeTime / this._shakeDur;
        const mag = this._shakeMag * progress;
        this._shakeX = (Math.random() * 2 - 1) * mag;
        this._shakeY = (Math.random() * 2 - 1) * mag;
      }
    }

    this.particles.update(dt);

    // Wave clear check
    if (this.enemies.length === 0 && this._state === 'playing') {
      this._emit(EVENTS.WAVE_CLEAR, { wave: this.wave });
      this._state = 'powerup';
      cancelAnimationFrame(this._rafId);
      setTimeout(() => this._showPowerupScreen(), 600);
    }
  }

  // ── Fire Bullet (spread 지원) ──────────────────────────────────────────────
  _fireBullet() {
    const p = this.player;
    p.fireCooldownLeft = p.fireCooldown;
    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
    const spawnDist = PLAYER_RADIUS + BULLET_RADIUS + 2;
    const muzzleX = p.x + cos * spawnDist;
    const muzzleY = p.y + sin * spawnDist;

    // Build spread angles
    let angles = [p.angle];
    if (p.spread >= 1) angles = [p.angle - 0.22, p.angle, p.angle + 0.22];
    if (p.spread >= 2) angles = [p.angle - 0.40, p.angle - 0.20, p.angle, p.angle + 0.20, p.angle + 0.40];

    for (const a of angles) {
      this.bullets.push({ x: muzzleX, y: muzzleY, vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED, pierced: 0 });
    }
    this.particles.emit(muzzleX, muzzleY, '#ffffff', 6, 80, 160, 0.06, 0.12, 0);
    this.audio.shoot();
    this._emit(EVENTS.SHOOT, {});
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  _render() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const p = this.player;
    ctx.save();
    ctx.fillStyle = TOKEN.CLR_BG;
    ctx.fillRect(0, 0, W, H);
    if (this._shakeX !== 0 || this._shakeY !== 0)
      ctx.translate(this._shakeX, this._shakeY);
    this._drawGrid(ctx, W, H);
    ctx.save();
    for (const s of this._stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    this.particles.draw(ctx);
    for (const e of this.enemies) this._drawEnemy(ctx, e);
    for (const b of this.bullets) this._drawBullet(ctx, b);
    this._drawPlayer(ctx, p);
    ctx.restore();
  }

  _drawGrid(ctx, W, H) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,229,255,0.04)';
    ctx.lineWidth = 1;
    const sp = 60;
    for (let x = 0; x < W; x += sp) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += sp) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
  }

  // ── Draw Player (V-9: shield aura) ─────────────────────────────────────────
  _drawPlayer(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);

    // V-9: shield 파란 원 아우라 (플레이어 뒤에 먼저 그림)
    if (p.shieldActive && p.shieldLeft > 0) {
      const auraR = PLAYER_RADIUS * 2.6;
      const pulse = 0.85 + 0.15 * Math.sin(p.shieldLeft * 0.008);
      ctx.save();
      ctx.shadowColor = TOKEN.CLR_SHIELD_RING;
      ctx.shadowBlur  = 24;
      ctx.fillStyle   = TOKEN.CLR_SHIELD_AURA;
      ctx.strokeStyle = TOKEN.CLR_SHIELD_RING;
      ctx.lineWidth   = 2;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(0, 0, auraR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(p.angle);
    if (p.invincible && Math.floor(p.invincibleLeft / 100) % 2 === 0) ctx.globalAlpha = 0.4;

    const r = PLAYER_RADIUS;
    ctx.shadowColor = TOKEN.CLR_PRIMARY; ctx.shadowBlur = 18;
    ctx.strokeStyle = TOKEN.CLR_PRIMARY;
    ctx.fillStyle   = 'rgba(0,229,255,0.15)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(r + 4, 0);
    ctx.lineTo(-r, -r * 0.7);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(-r, r * 0.7);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.shadowBlur = 10; ctx.fillStyle = 'rgba(0,229,255,0.6)';
    ctx.beginPath(); ctx.arc(-r * 0.4, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── Draw Enemy (V-1 flash + V-5 new types) ─────────────────────────────────
  _drawEnemy(ctx, e) {
    ctx.save();
    ctx.translate(e.x, e.y);

    const r = e.radius || ENEMY_RADIUS;

    if (e.type === 'zigzag') {
      // V-5: 10각 star (5 outer tips), 로테이션 있음
      ctx.rotate(e.wobble * 0.4);
      this._drawStar(ctx, 0, 0, 5, r, r * 0.44, e.color);
    } else if (e.type === 'flanker') {
      // V-5: 다이아몬드 4각
      ctx.rotate(e.wobble * 0.3);
      this._drawDiamond(ctx, 0, 0, r, e.color);
    } else if (e.type === 'elite') {
      // V-5: 8각 + 내부 링
      ctx.rotate(e.wobble * 0.2);
      this._drawElite(ctx, 0, 0, r, e.color);
    } else {
      // chaser: 기존 다각형
      ctx.rotate(e.wobble * 0.5);
      const sides = e.maxHp === 1 ? 4 : e.maxHp === 2 ? 6 : 8;
      ctx.shadowColor = e.color; ctx.shadowBlur = 14;
      ctx.strokeStyle = e.color; ctx.fillStyle = e.color + '22'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
        i === 0 ? ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r)
                : ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (e.maxHp > 1) {
        for (let i = 0; i < e.maxHp; i++) {
          const a = (i / e.maxHp) * Math.PI * 2 - Math.PI / 2;
          ctx.fillStyle = i < e.hp ? e.color : 'rgba(255,255,255,0.1)';
          ctx.shadowBlur = i < e.hp ? 6 : 0;
          ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // V-1: 비치명 피격 흰 플래시 오버레이 (rgba 255,255,255,0.8)
    if (e.flashTimer > 0) {
      const flashAlpha = 0.8 * Math.min(1, e.flashTimer / HIT_FLASH_DURATION);
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle   = '#ffffff';
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(0, 0, r + 1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ── Enemy Shape Helpers (V-5) ─────────────────────────────────────────────

  // 10각 star (5 outer tips)
  _drawStar(ctx, cx, cy, pts, outerR, innerR, color) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.strokeStyle = color; ctx.fillStyle = color + '22'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const rad   = i % 2 === 0 ? outerR : innerR;
      const angle = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(angle) * rad;
      const py = cy + Math.sin(angle) * rad;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // 다이아몬드 4각
  _drawDiamond(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.strokeStyle = color; ctx.fillStyle = color + '22'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx,           cy - r);
    ctx.lineTo(cx + r * 0.7, cy);
    ctx.lineTo(cx,           cy + r);
    ctx.lineTo(cx - r * 0.7, cy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // 8각 + 내부 링
  _drawElite(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.strokeStyle = color; ctx.fillStyle = color + '22'; ctx.lineWidth = 2;
    // Outer octagon
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 - Math.PI / 8;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Inner ring
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  _drawBullet(ctx, b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.shadowColor = TOKEN.CLR_BULLET; ctx.shadowBlur = 14;
    ctx.fillStyle = TOKEN.CLR_BULLET;
    ctx.beginPath(); ctx.arc(0, 0, BULLET_RADIUS, 0, Math.PI * 2); ctx.fill();
    const angle = Math.atan2(b.vy, b.vx);
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffab00';
    ctx.beginPath();
    ctx.arc(-Math.cos(angle) * 8, -Math.sin(angle) * 8, BULLET_RADIUS * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  _updateHUD() {
    const p = this.player;
    this.$scoreVal.textContent = this.score.toLocaleString();
    this.$enemyCount.textContent = this.enemies.length;
    this.$waveNum.textContent = this.wave;
    this.$hpIcons.forEach((el, i) => el.classList.toggle('lost', i >= p.hp));
  }

  // ── Score Popup ─────────────────────────────────────────────────────────────
  _spawnScorePopup(x, y, text) {
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = text;
    el.style.left = `${x - 20}px`;
    el.style.top  = `${y - 20}px`;
    document.getElementById('screen-game').appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  // ── Screen Shake ─────────────────────────────────────────────────────────────
  _shake(magnitude, duration) {
    this._shakeMag = magnitude; this._shakeDur = duration; this._shakeTime = duration;
  }

  // ── Effects ─────────────────────────────────────────────────────────────────
  _triggerRedFlash() {
    this.$flashOverlay.classList.remove('flash');
    void this.$flashOverlay.offsetWidth;
    this.$flashOverlay.classList.add('flash');
    setTimeout(() => this.$flashOverlay.classList.remove('flash'), 400);
  }
  _triggerGlowPulse() {
    this.$glowOverlay.classList.remove('glow');
    void this.$glowOverlay.offsetWidth;
    this.$glowOverlay.classList.add('glow');
    setTimeout(() => this.$glowOverlay.classList.remove('glow'), 750);
  }

  // ── Powerup Screen (V-3, V-4) ─────────────────────────────────────────────
  _pickPowerupCards() {
    // V-4: 반복 억제 — 미등장 타입 우선
    const unseen = POWERUP_DEFS.filter(p => !this._powerupSeenTypes.has(p.id));
    const seen   = POWERUP_DEFS.filter(p =>  this._powerupSeenTypes.has(p.id));
    const shuffle = arr => arr.slice().sort(() => Math.random() - 0.5);

    // V-3: 최대 1개 cyan → 나머지 2개는 다른 색
    // 시안 색 = PU_FIRE_RATE = '#00e5ff'
    const CYAN = TOKEN.PU_FIRE_RATE;

    const pool = [...shuffle(unseen), ...shuffle(seen)]; // 미등장 먼저
    const cards = [];
    let cyanCount = 0;

    for (const pu of pool) {
      if (cards.length >= 3) break;
      if (pu.color === CYAN && cyanCount >= 1) continue; // cyan은 최대 1장
      cards.push(pu);
      if (pu.color === CYAN) cyanCount++;
    }
    // 3장 미만이면 나머지로 채우기
    if (cards.length < 3) {
      const remaining = shuffle(POWERUP_DEFS.filter(p => !cards.includes(p)));
      for (const pu of remaining) {
        if (cards.length >= 3) break;
        cards.push(pu);
      }
    }

    const result = shuffle(cards).slice(0, 3);
    // V-4: 등장 기록
    result.forEach(c => this._powerupSeenTypes.add(c.id));
    return result;
  }

  _showPowerupScreen() {
    this._state = 'powerup';
    const ring = document.querySelector('.powerup-glow-ring');
    ring.style.animation = 'none'; void ring.offsetWidth; ring.style.animation = '';

    const cards = this._pickPowerupCards(); // V-3, V-4
    this.$powerupCards.innerHTML = '';
    cards.forEach(pu => {
      const card = document.createElement('div');
      card.className = 'powerup-card';
      // V-3: 개별 테두리 색 적용 (CSS var 쌍 — style prop으로 단일출처)
      card.style.setProperty('--pu-color', pu.color);
      card.style.borderColor = pu.color + 'aa';
      card.innerHTML = `
        <div class="pu-icon">${pu.icon}</div>
        <div class="pu-name" style="color:${pu.color}">${pu.name}</div>
        <div class="pu-desc">${pu.desc}</div>
      `;
      card.addEventListener('mouseenter', () => {
        card.style.borderColor = pu.color;
        card.style.boxShadow   = `0 0 24px color-mix(in srgb, ${pu.color} 40%, transparent)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.borderColor = pu.color + 'aa';
        card.style.boxShadow   = '';
      });
      card.addEventListener('click', () => this._selectPowerup(pu));
      this.$powerupCards.appendChild(card);
    });

    this._triggerGlowPulse();
    this.audio.powerup();
    this._showScreen('powerup');
  }

  _selectPowerup(pu) {
    pu.apply(this.player);
    this._emit(EVENTS.POWERUP_SELECT, { id: pu.id });
    this._triggerGlowPulse();
    this._state = 'playing';
    this._showScreen('game');
    this._updateHUD();
    this._accum = 0;
    this._startNextWave();
    requestAnimationFrame(ts => { this._lastTime = ts; this._loop(ts); });
  }

  // ── Pause / Resume ─────────────────────────────────────────────────────────
  _pauseGame() {
    if (this._state !== 'playing') return;
    this._state = 'paused';
    cancelAnimationFrame(this._rafId);
    this.audio.pauseBGM(); // S-4: 일시정지 시 BGM 페이드다운
    this.$pauseOverlay.classList.add('active');
  }
  _resumeGame() {
    if (this._state !== 'paused') return;
    this.$pauseOverlay.classList.remove('active');
    this._state = 'playing';
    this.audio.resumeBGM(); // S-4: 재개 시 BGM 페이드업
    requestAnimationFrame(ts => { this._lastTime = ts; this._loop(ts); });
  }

  // ── Best Score ─────────────────────────────────────────────────────────────
  _refreshBestDisplay() {
    const n = this._bestScore;
    if (n > 0) { this.$titleBestVal.textContent = n.toLocaleString(); this.$titleBest.classList.remove('hidden'); }
    this.$bestScoreVal.textContent = n.toLocaleString();
  }

  // ── Game Over ──────────────────────────────────────────────────────────────
  _gameOver() {
    this._state = 'gameover';
    cancelAnimationFrame(this._rafId);
    this.audio.stopBGM(); // S-4: 게임 오버 시 BGM 중단
    if (this.score > this._bestScore) {
      this._bestScore = this.score;
      localStorage.setItem('bestScore', String(this._bestScore));
    }
    this._refreshBestDisplay();
    this.$finalScore.textContent = this.score.toLocaleString();
    this.$finalWave.textContent  = this.wave;
    this.$finalKills.textContent = this.kills;
    this._showScreen('gameover');
  }

  // ── Event Emitter ──────────────────────────────────────────────────────────
  _emit(type, data) { console.log(`[EVENT] ${type}`, data); }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { window._game = new Game(); });
