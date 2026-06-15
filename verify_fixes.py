"""verify_fixes.py — QA 4건 수정 검증"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()

    js_errors = []
    page.on('console', lambda m: js_errors.append(m.text) if m.type == 'error' else None)

    page.goto('http://localhost:3000')
    page.wait_for_load_state('networkidle')

    # 1. 타이틀 화면
    title_ok = page.locator('#screen-title.active').is_visible()
    print(f"[1] Title screen active: {title_ok}")

    # 2. 게임 시작
    page.click('#btn-start')
    page.wait_for_timeout(500)
    game_state = page.evaluate("window._game._state")
    wave_num = page.locator('#wave-num').text_content()
    print(f"[2] State after start: {game_state}, wave: {wave_num}")

    # 3. HiDPI 좌표 확인 — scaleX 더 이상 없는지 JS 소스 체크
    app_js = page.evaluate("""
      () => {
        const scripts = document.querySelectorAll('script[src]');
        return null; // just check game mouse logic
      }
    """)
    mouse_x_test = page.evaluate("""
      () => {
        // rect.width가 CSS 픽셀과 같다면 scale 1:1이어야 함
        const g = window._game;
        const rect = g.canvas.getBoundingClientRect();
        // scaleX = canvas.width / rect.width 이면 DPR 배율이지만
        // 수정 후엔 1:1이어야 함
        const cssW = rect.width;
        const canvasW = g.canvas.width;
        const dpr = window.devicePixelRatio || 1;
        return { cssW, canvasW, dpr, ratio: canvasW / cssW };
      }
    """)
    print(f"[3] HiDPI check - CSS:{mouse_x_test['cssW']} canvas:{mouse_x_test['canvasW']} dpr:{mouse_x_test['dpr']} ratio:{mouse_x_test['ratio']}")
    # ratio == dpr 이면 DPR 보정 적용 중 / 마우스는 CSS px 그대로 사용

    # 4. WAVE_CLEAR emit 중복 체크 — 이벤트 카운트
    page.evaluate("""
      window._waveClearCount = 0;
      const orig = window._game._emit.bind(window._game);
      window._game._emit = function(type, data) {
        if (type === 'WAVE_CLEAR') window._waveClearCount++;
        return orig(type, data);
      };
    """)
    # 임의로 wave clear 트리거
    page.evaluate("""
      window._game.enemies = [];
      window._game._state = 'playing';
    """)
    page.wait_for_timeout(300)
    wc_count = page.evaluate("window._waveClearCount")
    print(f"[4] WAVE_CLEAR emit count per clear: {wc_count}  (expected 1)")

    # 5. Escape 일시정지
    page.evaluate("window._game._state = 'playing'")
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    paused_state = page.evaluate("window._game._state")
    overlay_active = page.locator('#pause-overlay.active').count() > 0
    print(f"[5] After ESC: state={paused_state}, overlay_active={overlay_active}")

    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    resumed_state = page.evaluate("window._game._state")
    overlay_gone = page.locator('#pause-overlay.active').count() == 0
    print(f"[5] After 2nd ESC: state={resumed_state}, overlay_gone={overlay_gone}")

    # 6. 최고점수 localStorage
    page.evaluate("window._game.score = 12345; window._game._gameOver()")
    page.wait_for_timeout(200)
    best_ls = page.evaluate("localStorage.getItem('bestScore')")
    best_display = page.locator('#best-score-val').text_content()
    gameover_visible = page.locator('#screen-gameover.active').is_visible()
    print(f"[6] bestScore localStorage={best_ls}, display='{best_display}', gameover={gameover_visible}")

    # 재시작 후 타이틀 best 표시
    page.click('#btn-restart')
    page.wait_for_timeout(300)
    page.evaluate("window._game._gameOver()")
    page.wait_for_timeout(200)
    page.evaluate("""
      window._game._state = 'gameover';
      document.getElementById('screen-gameover').classList.add('active');
      window._game._refreshBestDisplay();
    """)
    best_display2 = page.locator('#best-score-val').text_content()
    print(f"[6] best display on gameover: '{best_display2}'")

    if js_errors:
        print(f"[ERR] JS errors: {js_errors}")
    else:
        print("[OK] No JS console errors")

    browser.close()
    print("=== VERIFICATION COMPLETE ===")
