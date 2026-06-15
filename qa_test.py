#!/usr/bin/env python3
"""QA Playwright test for Wave Defender game"""
import time
from playwright.sync_api import sync_playwright

URL = "https://organt-p-015.onrender.com"

results = {}
console_errors = []
console_logs = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--no-sandbox"])
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 720},
        device_scale_factor=2,  # HiDPI simulation (DPR=2)
        ignore_https_errors=True
    )
    page = ctx.new_page()
    page.on("console", lambda msg: console_errors.append(f"[{msg.type}] {msg.text}")
            if msg.type in ("error","warning")
            else console_logs.append(f"[{msg.type}] {msg.text}"))
    page.on("pageerror", lambda err: console_errors.append(f"[PAGEERROR] {err}"))

    print(f"[LOAD] Navigating to {URL}")
    page.goto(URL, timeout=40000)
    page.wait_for_load_state("networkidle", timeout=25000)
    print("[LOAD] Page loaded OK")

    # Title screen check
    title_vis = page.is_visible("#screen-title.active")
    print(f"[TITLE] Screen visible: {title_vis}")

    # localStorage best score
    best_before = page.evaluate("localStorage.getItem('bestScore')")
    print(f"[LS] bestScore before game: {best_before}")

    # ─ Item 1: Start game ─
    page.click("#btn-start")
    time.sleep(0.5)
    game_vis = page.is_visible("#screen-game.active")
    wave_num = page.text_content("#wave-num")
    enemy_count = page.text_content("#enemy-count")
    print(f"[1] Game screen active: {game_vis}, Wave={wave_num}, Enemies={enemy_count}")
    results["wave1_8_enemies"] = (wave_num == "1" and int(enemy_count or "0") == 8)

    # ─ Item 1: WASD movement ─
    px_before = page.evaluate("window._game?.player?.x")
    page.keyboard.down("KeyD")
    time.sleep(0.35)
    px_after = page.evaluate("window._game?.player?.x")
    page.keyboard.up("KeyD")
    moved = px_after is not None and px_before is not None and px_after > px_before
    print(f"[1] WASD movement: {px_before} -> {px_after} = {'PASS' if moved else 'FAIL'}")
    results["movement_wasd"] = moved

    # ─ Item 6: HiDPI mouse coordinate ─
    page.mouse.move(640, 360)
    time.sleep(0.08)
    mx = page.evaluate("window._game?.input?.mouse?.x")
    my = page.evaluate("window._game?.input?.mouse?.y")
    hidpi_ok = mx is not None and abs(mx - 640) < 40 and abs(my - 360) < 40
    print(f"[6] HiDPI mouse: got ({mx},{my}), expected ~(640,360) = {'PASS' if hidpi_ok else 'FAIL'}")
    results["hidpi_mouse"] = hidpi_ok

    # ─ Item 1: Mouse aim angle ─
    page.mouse.move(100, 100)
    time.sleep(0.08)
    angle_ul = page.evaluate("window._game?.player?.angle")
    page.mouse.move(1180, 100)
    time.sleep(0.08)
    angle_ur = page.evaluate("window._game?.player?.angle")
    aim_ok = angle_ul is not None and angle_ur is not None and angle_ul != angle_ur
    print(f"[1] Mouse aim angles: UL={angle_ul:.3f}, UR={angle_ur:.3f} = {'PASS' if aim_ok else 'FAIL'}")
    results["mouse_aim"] = aim_ok

    # ─ Item 1: Shooting ─
    page.mouse.move(900, 360)
    time.sleep(0.05)
    bullets_before = page.evaluate("window._game?.bullets?.length")
    page.mouse.down()
    time.sleep(0.45)
    bullets_mid = page.evaluate("window._game?.bullets?.length")
    page.mouse.up()
    shoot_events = [l for l in console_logs if "[EVENT] SHOOT" in l]
    shot_ok = len(shoot_events) > 0
    print(f"[1] Shooting: bullets_before={bullets_before}, mid={bullets_mid}, SHOOT_events={len(shoot_events)} = {'PASS' if shot_ok else 'FAIL'}")
    results["shooting"] = shot_ok

    # ─ Item 3: ESC pause ─
    page.keyboard.press("Escape")
    time.sleep(0.25)
    pause_active = page.is_visible("#pause-overlay.active")
    game_state_paused = page.evaluate("window._game?._state")
    print(f"[3] Pause overlay: {pause_active}, state: {game_state_paused}")
    results["pause"] = pause_active and game_state_paused == "paused"

    page.keyboard.press("Escape")
    time.sleep(0.25)
    pause_gone = not page.is_visible("#pause-overlay.active")
    game_state_resumed = page.evaluate("window._game?._state")
    print(f"[3] Resume: pause_gone={pause_gone}, state={game_state_resumed}")
    results["resume"] = pause_gone and game_state_resumed == "playing"

    # ─ Let game run to clear wave 1: dynamic aiming toward nearest enemy ─
    print("[2] Running game ~20s to clear wave 1 (dynamic aim at nearest enemy)...")
    page.mouse.down()
    t_start = time.time()
    first_kill_t = None
    wave_cleared = False
    for i in range(40):  # 0.5s ticks = up to 20s
        time.sleep(0.5)
        state = page.evaluate("window._game?._state")
        kills = page.evaluate("window._game?.kills || 0")
        enemies = page.evaluate("window._game?.enemies?.length")
        if kills and kills > 0 and first_kill_t is None:
            first_kill_t = time.time() - t_start
        if state in ("powerup", "gameover"):
            wave_cleared = (state == "powerup")
            print(f"[2] State={state} at ~{(i+1)*0.5:.1f}s! kills={kills}")
            break
        # Dynamic aim: move mouse toward nearest enemy (in CSS pixels, same as game coords)
        try:
            near = page.evaluate("""
                (() => {
                    const g = window._game;
                    if (!g || !g.enemies || !g.enemies.length) return null;
                    let best = null, bestD = Infinity;
                    for (const e of g.enemies) {
                        const d = Math.hypot(e.x - g.player.x, e.y - g.player.y);
                        if (d < bestD) { bestD = d; best = {x: e.x, y: e.y}; }
                    }
                    return best;
                })()
            """)
            if near:
                page.mouse.move(near["x"], near["y"])
        except Exception:
            pass
        if i % 4 == 0:
            print(f"  t={i*0.5:.1f}s: state={state}, kills={kills}, enemies={enemies}")
    page.mouse.up()

    first_kill_ok = first_kill_t is not None and first_kill_t <= 15
    ftstr = f"{first_kill_t:.1f}" if first_kill_t is not None else "None"
    print(f"[1] First kill at {ftstr}s = {'PASS' if first_kill_ok else 'FAIL (>15s or none)'}")
    results["first_kill_15s"] = first_kill_ok
    results["wave1_clear"] = wave_cleared

    kill_events = [l for l in console_logs if "[EVENT] KILL" in l]
    score_events = [l for l in console_logs if "[EVENT] SCORE_ADD" in l]
    print(f"[1] KILL events={len(kill_events)}, SCORE_ADD events={len(score_events)}")

    # ─ Item 2: Powerup screen ─
    if wave_cleared:
        time.sleep(0.8)  # wait for powerup screen animation
        powerup_vis = page.is_visible("#screen-powerup.active")
        cards = page.query_selector_all(".powerup-card")
        print(f"[2] Powerup screen: {powerup_vis}, cards: {len(cards)}")
        results["powerup_screen"] = powerup_vis and len(cards) == 3

        # Select first powerup
        if len(cards) > 0:
            cards[0].click()
            time.sleep(0.5)
            state_after_pu = page.evaluate("window._game?._state")
            wave_after = page.evaluate("window._game?.wave")
            print(f"[2] After powerup select: state={state_after_pu}, wave={wave_after}")
            results["powerup_select"] = state_after_pu == "playing" and wave_after == 2
            powerup_sel_events = [l for l in console_logs if "[EVENT] POWERUP_SELECT" in l]
            print(f"[2] POWERUP_SELECT events: {len(powerup_sel_events)}")
        else:
            results["powerup_screen"] = False
            results["powerup_select"] = False
    else:
        print("[2] Wave not cleared, skipping powerup test")
        results["powerup_screen"] = False
        results["powerup_select"] = False

    # ─ Continue to game over (fast path: let enemies kill player) ─
    # Run a bit more, then check game over
    print("[4] Running wave 2 briefly (~10s)...")
    page.mouse.move(640, 360)
    page.mouse.down()
    time.sleep(10)
    page.mouse.up()

    state_now = page.evaluate("window._game?._state")
    score_now = page.evaluate("window._game?.score")
    print(f"[4] After wave2: state={state_now}, score={score_now}")

    # Force game over by injecting hp=0
    if state_now == "playing":
        page.evaluate("window._game.player.hp = 0; window._game._gameOver()")
        time.sleep(0.4)

    gameover_vis = page.is_visible("#screen-gameover.active")
    final_score_el = page.text_content("#final-score")
    best_el = page.text_content("#best-score-val")
    best_ls = page.evaluate("localStorage.getItem('bestScore')")
    print(f"[4] Gameover screen: {gameover_vis}, final_score={final_score_el}, best_el={best_el}, best_ls={best_ls}")
    results["gameover_screen"] = gameover_vis
    results["best_score_ls"] = best_ls is not None and int(best_ls or "0") > 0

    # ─ Item 5: Console errors ─
    js_errors = [e for e in console_errors if "[error]" in e.lower() or "[pageerror]" in e.lower()]
    results["no_js_errors"] = len(js_errors) == 0
    print(f"[5] JS errors: {len(js_errors)}")
    for e in js_errors:
        print(f"  ERROR: {e}")

    browser.close()

print("\n" + "="*50)
print("QA RESULTS:")
print("="*50)
mapping = {
    "wave1_8_enemies": "Item1 - Wave1 8적 스폰",
    "movement_wasd":   "Item1 - WASD 이동",
    "mouse_aim":       "Item1 - 마우스 조준",
    "shooting":        "Item1 - 발사(SHOOT)",
    "pause":           "Item3 - ESC 일시정지",
    "resume":          "Item3 - ESC 재개",
    "first_kill_15s":  "Item1 - 15초 내 첫 KILL",
    "wave1_clear":     "Item2 - 웨이브1 클리어",
    "powerup_screen":  "Item2 - 파워업 화면",
    "powerup_select":  "Item2 - 파워업 선택 후 웨이브2",
    "gameover_screen": "Item4 - 게임오버 화면",
    "best_score_ls":   "Item4 - bestScore localStorage",
    "no_js_errors":    "Item5 - JS 콘솔 에러 0",
    "hidpi_mouse":     "Item6 - HiDPI 마우스 좌표",
}
for key, label in mapping.items():
    v = results.get(key, "N/A")
    status = "PASS" if v is True else ("FAIL" if v is False else f"N/A({v})")
    print(f"  [{status:4s}] {label}")
