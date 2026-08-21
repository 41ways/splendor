/* 봇 테스트 — node ai.test.js */
var R = require('./rules.js');
var AI = require('./ai.js');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function game(n, seed) {
  var a = []; for (var i = 0; i < n; i++) a.push({ id: 'p' + i, name: 'P' + i, bot: true });
  return R.newGame(a, seed || 1);
}
// 원하는 카드만 판에 깔아둔다
function setBoard(s, tier, cards) {
  for (var i = 0; i < 4; i++) s.board[tier][i] = cards[i] || null;
}
function card(tier, gem, pts, cost) {
  return { id: 'x' + tier + gem + pts + JSON.stringify(cost), tier: tier, gem: gem, pts: pts, cost: cost };
}
function decide(s, pid) { return AI.act(R.viewFor(s, pid || 'p0'), 1); }

section('살 수 있으면 산다');
(function () {
  var s = game(2, 3);
  var target = card(2, 'k', 3, { u: 2 });
  setBoard(s, 2, [target]);
  s.players[0].gems.u = 2;
  var a = decide(s);
  ok('점수 카드를 집어 든다', a.action === 'buy' && a.args[0] === target.id, a.action);
})();

section('0점 엔진 카드도 초반에는 산다');
(function () {
  var s = game(2, 4);
  var cheap = card(1, 'g', 0, { r: 2, k: 1 });
  setBoard(s, 1, [cheap]);
  s.players[0].gems.r = 2; s.players[0].gems.k = 1;
  var a = decide(s);
  ok('보석만 모으고 있지 않는다', a.action === 'buy' && a.args[0] === cheap.id, a.action);
})();

section('막판에는 점수를 우선한다');
(function () {
  var engine = card(1, 'g', 0, { r: 1 });
  var scorer = card(2, 'k', 2, { r: 1 });

  var early = game(2, 5);
  setBoard(early, 1, [engine]); setBoard(early, 2, [scorer]);
  early.players[0].gems.r = 1;

  var late = game(2, 5);
  setBoard(late, 1, [engine]); setBoard(late, 2, [scorer]);
  late.players[0].gems.r = 1;
  late.players[1].pts = 13;                      // 상대가 코앞이다

  var a1 = decide(early), a2 = decide(late);
  ok('막판에는 2점 카드', a2.action === 'buy' && a2.args[0] === scorer.id, a2.args && a2.args[0]);
  ok('둘 다 합법적인 구매', a1.action === 'buy' && a2.action === 'buy');
})();

section('보석은 목표에 맞춰 집는다');
(function () {
  var s = game(2, 6);
  var goal = card(2, 'k', 2, { u: 4, g: 2 });
  setBoard(s, 1, []); setBoard(s, 2, [goal]); setBoard(s, 3, []);
  var a = decide(s);
  ok('보석을 집는다', a.action === 'takeGems', a.action);
  if (a.action === 'takeGems') {
    var picked = a.args[0];
    ok('필요한 색만 집는다', picked.every(function (c) { return c === 'u' || c === 'g'; }), picked.join(','));
    ok('가장 많이 필요한 색이 들어 있다', picked.indexOf('u') >= 0, picked.join(','));
    ok('규칙에 맞는다', R.takeGems(s, 'p0', picked).ok);
  }
})();

section('킵');
(function () {
  var s = game(2, 7);
  // 바닥에 보석이 없으면 집을 수가 없다 → 킵으로 황금을 챙긴다
  R.COLORS.forEach(function (c) { s.bank[c] = 0; });
  var a = decide(s);
  ok('보석을 못 집으면 킵', a.action === 'reserve' || a.action === 'reserveTop', a.action);
  ok('그 수가 실제로 통한다', R[a.action].apply(null, [s, 'p0'].concat(a.args)).ok);
})();

section('넘치는 칩 버리기');
(function () {
  var s = game(3, 8);
  s.players[0].gems = { w: 3, u: 3, g: 3, r: 2, k: 1, y: 1 };
  s.phase = 'discard';
  var drop = AI.chooseDiscard(R.viewFor(s, 'p0'));
  ok('정확히 넘친 만큼', drop.length === R.tokenCount(s.players[0]) - R.MAX_TOKENS, drop.length);
  ok('황금은 남긴다', drop.indexOf('y') < 0, drop.join(','));
  ok('가진 것만 버린다', R.discard(s, 'p0', drop).ok);
  ok('10개가 된다', R.tokenCount(s.players[0]) === 10);
})();

section('실력을 낮춰도 합법적이다');
(function () {
  var bad = 0, tried = 0;
  [0.4, 0.7, 1].forEach(function (skill) {
    for (var g = 0; g < 40; g++) {
      var s = game(3, g * 5 + 77);
      s.players.forEach(function (p) { p.bot = true; });
      for (var step = 0; step < 120 && s.phase !== 'over'; step++) {
        var pid = R.current(s).id, v = R.viewFor(s, pid), r;
        if (s.phase === 'discard') r = R.discard(s, pid, AI.chooseDiscard(v));
        else if (s.phase === 'noble') r = R.pickNoble(s, pid, AI.chooseNoble(v));
        else {
          var a = AI.act(v, skill);
          tried++;
          r = a ? R[a.action].apply(null, [s, pid].concat(a.args)) : { ok: false };
        }
        if (!r.ok) { bad++; break; }
      }
    }
  });
  ok('120판 내내 규칙에 걸리지 않음', bad === 0, bad);
  console.log('  판단 ' + tried + '번');
})();

section('실력이 낮으면 약하다');
(function () {
  // 쉬움 봇과 어려움 봇을 붙여 본다
  var hardWins = 0, games = 200;
  for (var g = 0; g < games; g++) {
    var s = game(2, g * 11 + 3);
    var skills = { p0: g % 2 ? 1 : 0.4, p1: g % 2 ? 0.4 : 1 };   // 선공을 번갈아 준다
    for (var step = 0; step < 2000 && s.phase !== 'over'; step++) {
      var pid = R.current(s).id, v = R.viewFor(s, pid), r;
      if (s.phase === 'discard') r = R.discard(s, pid, AI.chooseDiscard(v));
      else if (s.phase === 'noble') r = R.pickNoble(s, pid, AI.chooseNoble(v));
      else {
        var a = AI.act(v, skills[pid]);
        r = a ? R[a.action].apply(null, [s, pid].concat(a.args)) : { ok: false };
      }
      if (!r.ok) break;
    }
    if (s.phase === 'over' && skills[s.winner] === 1) hardWins++;
  }
  var rate = hardWins / games;
  ok('어려움이 쉬움보다 자주 이긴다', rate > 0.55, (rate * 100).toFixed(0) + '%');
  console.log('  어려움 승률 ' + (rate * 100).toFixed(0) + '%');
})();

console.log('\n' + (fail ? '실패 ' + fail + ' / ' : '') + '통과 ' + pass);
process.exit(fail ? 1 : 0);
