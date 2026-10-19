export function setup(uiCtx) {
  const { vue, registerApp } = uiCtx;
  const { h, ref, computed, onUnmounted } = vue;

  const MODES = [
    { key: 'focus', label: '专注', color: '#e5484d' },
    { key: 'short', label: '短休', color: '#30a46c' },
    { key: 'long', label: '长休', color: '#3f7ff5' }
  ];

  const component = {
    name: 'PomodoroTimerApp',
    setup() {
      const focusMin = ref(25);
      const shortMin = ref(5);
      const longMin = ref(15);
      const durations = { focus: focusMin, short: shortMin, long: longMin };

      const mode = ref('focus');
      const left = ref(25 * 60);
      const running = ref(false);
      const doneCount = ref(0);
      const showSettings = ref(false);
      const hint = ref('');

      let endAt = 0;
      let timer = null;
      const timeouts = [];

      const minutesOf = (k) => {
        const v = Number(durations[k] ? durations[k].value : 25);
        return Math.max(1, Math.min(180, Math.round(v || 0) || 1));
      };
      const totalOf = (k) => minutesOf(k) * 60;

      const total = computed(() => totalOf(mode.value));
      const themeOf = (k) => {
        for (let i = 0; i < MODES.length; i++) if (MODES[i].key === k) return MODES[i];
        return MODES[0];
      };
      const theme = computed(() => themeOf(mode.value));
      const ratio = computed(() => {
        const t = total.value;
        if (!t) return 0;
        return Math.max(0, Math.min(1, left.value / t));
      });
      const timeText = computed(() => {
        const s = Math.max(0, Math.round(left.value));
        const m = Math.floor(s / 60);
        return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      });
      const nextLabel = computed(() => {
        if (mode.value !== 'focus') return '专注';
        return (doneCount.value + 1) % 4 === 0 ? '长休' : '短休';
      });

      function stopTimer() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }

      function start() {
        if (running.value) return;
        if (left.value <= 0) left.value = total.value;
        stopTimer();
        endAt = Date.now() + left.value * 1000;
        running.value = true;
        hint.value = '';
        timer = setInterval(tick, 200);
      }

      function pause() {
        if (!running.value) return;
        running.value = false;
        stopTimer();
        const remain = Math.max(0, Math.round((endAt - Date.now()) / 1000));
        left.value = remain;
      }

      function toggle() {
        if (running.value) pause();
        else start();
      }

      function reset() {
        stopTimer();
        running.value = false;
        left.value = total.value;
        hint.value = '';
      }

      function switchMode(k) {
        stopTimer();
        running.value = false;
        mode.value = k;
        left.value = totalOf(k);
        hint.value = '';
      }

      function advance(counted, finishedNaturally) {
        const wasFocus = mode.value === 'focus';
        if (wasFocus && counted) doneCount.value += 1;
        const next = wasFocus
          ? (doneCount.value > 0 && doneCount.value % 4 === 0 ? 'long' : 'short')
          : 'focus';
        const finishedLabel = wasFocus ? '专注' : themeOf(mode.value).label;
        mode.value = next;
        left.value = totalOf(next);
        hint.value = finishedLabel + (finishedNaturally ? '结束，' : '已跳过，') + '进入「' + themeOf(next).label + '」';
      }

      function finish() {
        stopTimer();
        running.value = false;
        left.value = 0;
        beep(2);
        hint.value = '时间到！准备切换…';
        timeouts.push(setTimeout(() => advance(true, true), 1200));
      }

      function skip() {
        stopTimer();
        running.value = false;
        advance(false, false);
      }

      function tick() {
        const remain = Math.round((endAt - Date.now()) / 1000);
        if (remain <= 0) {
          left.value = 0;
          finish();
          return;
        }
        left.value = remain;
      }

      function beep(times) {
        try {
          const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
          if (!AC) return;
          const ctx = new AC();
          let t = ctx.currentTime;
          for (let i = 0; i < times; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, t);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.4);
            t += 0.45;
          }
          timeouts.push(setTimeout(() => {
            try { ctx.close(); } catch (e) { /* ignore */ }
          }, times * 450 + 300));
        } catch (e) { /* 静默失败，不影响计时 */ }
      }

      onUnmounted(() => {
        stopTimer();
        while (timeouts.length) {
          const id = timeouts.pop();
          try { clearTimeout(id); } catch (e) { /* ignore */ }
        }
      });

      const GAP = { background: 'rgba(127,127,127,.14)', border: '1px solid rgba(127,127,127,.22)' };
      const btnBase = {
        padding: '9px 16px',
        borderRadius: '10px',
        fontSize: '13px',
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
        lineHeight: '1.4',
        ...GAP
      };
      const tabStyle = (m, active) => ({
        flex: '1',
        padding: '8px 6px',
        borderRadius: '9px',
        fontSize: '13px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        border: 'none',
        color: active ? '#fff' : 'inherit',
        background: active ? m.color : 'transparent',
        opacity: active ? 1 : 0.6,
        transition: 'background .2s, opacity .2s'
      });

      const ring = (color, r) => {
        const C = 2 * Math.PI * 45;
        return h('svg', {
          viewBox: '0 0 100 100',
          width: '240',
          height: '240',
          style: { transform: 'rotate(-90deg)', display: 'block' }
        }, [
          h('circle', { cx: 50, cy: 50, r: 45, fill: 'none', stroke: 'rgba(127,127,127,.18)', 'stroke-width': 6 }),
          h('circle', {
            cx: 50, cy: 50, r: 45, fill: 'none', stroke: color, 'stroke-width': 6,
            'stroke-linecap': 'round',
            'stroke-dasharray': String(C),
            'stroke-dashoffset': String(C * (1 - r)),
            style: { transition: 'stroke-dashoffset .25s linear, stroke .3s ease' }
          })
        ]);
      };

      function settingsEl() {
        const rows = [
          { key: 'focus', label: '专注时长' },
          { key: 'short', label: '短休时长' },
          { key: 'long', label: '长休时长' }
        ];
        return h('div', {
          style: {
            marginTop: '18px',
            padding: '4px 14px 12px',
            borderRadius: '12px',
            ...GAP,
            border: '1px solid rgba(127,127,127,.22)'
          }
        }, rows.map((row, i) => h('label', {
          key: row.key,
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '12px', padding: '10px 0', fontSize: '13px',
            borderTop: i === 0 ? 'none' : '1px solid rgba(127,127,127,.15)'
          }
        }, [
          h('span', { style: { opacity: 0.8 } }, row.label),
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            h('input', {
              type: 'number', min: 1, max: 180, value: durations[row.key].value,
              disabled: running.value,
              onInput: (e) => {
                const raw = Math.round(Number(e.target.value));
                const v = Math.max(1, Math.min(180, raw || 1));
                durations[row.key].value = v;
                if (!running.value && mode.value === row.key) left.value = v * 60;
              },
              style: {
                width: '62px', padding: '5px 8px', borderRadius: '8px',
                border: '1px solid rgba(127,127,127,.28)',
                background: 'rgba(127,127,127,.12)', color: 'inherit',
                fontFamily: 'inherit', fontSize: '13px', textAlign: 'center'
              }
            }),
            h('span', { style: { opacity: 0.5 } }, '分钟')
          ])
        ])));
      }

      return () => {
        const th = theme.value;
        const r = ratio.value;
        return h('div', {
          style: {
            padding: '26px 20px 34px',
            maxWidth: '520px',
            margin: '0 auto',
            fontFamily: 'inherit',
            color: 'inherit',
            boxSizing: 'border-box'
          }
        }, [
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '12px', marginBottom: '16px'
            }
          }, [
            h('div', {}, [
              h('div', { style: { fontSize: '18px', fontWeight: 600 } }, '番茄钟'),
              h('div', { style: { fontSize: '12px', opacity: 0.55, marginTop: '3px' } },
                '已完成 ' + doneCount.value + ' 个专注 · 完成后下一段是「' + nextLabel.value + '」')
            ]),
            h('button', {
              style: { ...btnBase, padding: '7px 12px', fontSize: '12px' },
              onClick: () => { showSettings.value = !showSettings.value; }
            }, showSettings.value ? '收起设置' : '设置')
          ]),

          h('div', {
            style: {
              display: 'flex', gap: '6px', padding: '4px',
              borderRadius: '11px', marginBottom: '22px', ...GAP
            }
          }, MODES.map((m) => h('button', {
            key: m.key,
            onClick: () => switchMode(m.key),
            style: tabStyle(m, mode.value === m.key)
          }, m.label))),

          h('div', { style: { position: 'relative', width: '240px', height: '240px', margin: '0 auto' } }, [
            ring(th.color, r),
            h('div', {
              style: {
                position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center'
              }
            }, [
              h('div', {
                style: {
                  fontSize: '46px', fontWeight: 600, letterSpacing: '1px',
                  fontVariantNumeric: 'tabular-nums'
                }
              }, timeText.value),
              h('div', { style: { fontSize: '13px', opacity: 0.6, marginTop: '4px' } },
                th.label + (running.value ? ' · 进行中' : ' · 已暂停'))
            ])
          ]),

          h('div', {
            style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '22px' }
          }, [
            h('button', {
              style: {
                ...btnBase,
                padding: '10px 26px',
                border: 'none',
                color: '#fff',
                background: th.color,
                fontWeight: 600,
                boxShadow: '0 6px 18px -8px ' + th.color
              },
              onClick: toggle
            }, running.value ? '暂停' : (left.value > 0 && left.value < total.value ? '继续' : '开始')),
            h('button', { style: btnBase, onClick: reset }, '重置'),
            h('button', { style: btnBase, onClick: skip }, '跳过')
          ]),

          hint.value
            ? h('div', {
              style: {
                marginTop: '14px', textAlign: 'center',
                fontSize: '12px', opacity: 0.65
              }
            }, hint.value)
            : null,

          showSettings.value ? settingsEl() : null,

          h('div', {
            style: {
              marginTop: '20px', textAlign: 'center',
              fontSize: '11px', opacity: 0.4, lineHeight: 1.6
            }
          }, '每完成 4 个专注自动进入长休 · 结束时有提示音 · 时长修改后即时生效')
        ]);
      };
    }
  };

  registerApp({
    id: 'pomodoro-timer',
    title: '番茄钟',
    icon: 'timer',
    route: '/pomodoro-timer',
    order: 66,
    component
  });
}
