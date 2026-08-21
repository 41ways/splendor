/* 스플렌더 — 봇
   보이는 것만 가지고 판단한다. 남의 뒷면 킵 안은 모른다.

   생각의 순서는 사람이 하는 것과 같다.
   1. 지금 살 수 있는 카드 중 제일 값진 게 충분히 값지면 산다.
   2. 아니면 목표 카드를 하나 정하고, 거기 모자란 보석을 집는다.
   3. 목표가 너무 멀거나 보석을 못 집으면 킵해서 황금을 챙긴다. */
(function (root) {
  'use strict';
  var R = (typeof require !== 'undefined') ? require('./rules.js') : root.Rules;
  var COLORS = R.COLORS, GOLD = R.GOLD;

  function me(view) {
    for (var i = 0; i < view.players.length; i++) if (view.players[i].id === view.me) return view.players[i];
    return null;
  }
  function boardCards(view) {
    var out = [];
    for (var t = 1; t <= 3; t++) {
      for (var i = 0; i < view.board[t].length; i++) if (view.board[t][i]) out.push(view.board[t][i]);
    }
    return out;
  }
  function onBoard(view, id) {
    var list = boardCards(view);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return true;
    return false;
  }
  function myReserved(view, p) {
    return p.reserved.filter(function (r) { return r.card; }).map(function (r) { return r.card; });
  }

  /* 색깔별 값어치 — 남은 귀족이 얼마나 요구하는지 + 깔린 카드가 얼마나 요구하는지 */
  function colorWeights(view, p) {
    var w = {};
    COLORS.forEach(function (c) { w[c] = 0.2; });

    view.nobles.forEach(function (nb) {
      var gap = 0, colors = [];
      for (var c in nb.need) {
        if (!Object.prototype.hasOwnProperty.call(nb.need, c)) continue;
        var miss = Math.max(0, nb.need[c] - (p.bonus[c] || 0));
        gap += miss; colors.push(c);
      }
      if (gap === 0) return;
      var near = 1 / (1 + gap * 0.6);          // 가까운 귀족일수록 세게 끌린다
      colors.forEach(function (c) {
        if ((p.bonus[c] || 0) < nb.need[c]) w[c] += 1.4 * near;
      });
    });

    boardCards(view).forEach(function (card) {
      for (var c in card.cost) {
        if (!Object.prototype.hasOwnProperty.call(card.cost, c)) continue;
        w[c] += card.cost[c] * 0.05 * (card.tier === 3 ? 1.6 : card.tier === 2 ? 1.2 : 0.7);
      }
    });

    // 이미 많이 가진 색은 한 장 더 얹어도 덜 쓸모 있다
    COLORS.forEach(function (c) { w[c] *= 1 / (1 + (p.bonus[c] || 0) * 0.25); });
    return w;
  }

  function leaderPts(view) {
    var m = 0; view.players.forEach(function (q) { if (q.pts > m) m = q.pts; }); return m;
  }

  /* 카드의 값어치를 '보석 몇 개어치'로 친다.
     0점짜리도 값이 있다 — 보너스는 판이 끝날 때까지 계속 깎아주고 귀족도 불러온다.
     대신 판이 막바지면 보너스는 쓸 데가 없어지고 점수만 남는다. */
  function value(card, view, p, w) {
    var late = view.endRound || leaderPts(view) >= 11;
    var bonusWorth = (late ? 0.7 : 2.6) + (w[card.gem] || 0) * (late ? 0.3 : 1.3);
    return card.pts * (late ? 3.2 : 2.0) + bonusWorth;
  }

  // 이 카드까지 몇 개나 더 모아야 하나 (황금으로 메울 수 있는 만큼은 빼고)
  function distance(p, card) {
    var need = 0;
    COLORS.forEach(function (c) {
      need += Math.max(0, (card.cost[c] || 0) - (p.bonus[c] || 0) - (p.gems[c] || 0));
    });
    return Math.max(0, need - (p.gems[GOLD] || 0));
  }

  function bestBuy(view, p, w) {
    var best = null, list = boardCards(view).concat(myReserved(view, p));
    list.forEach(function (card) {
      if (!R.payFor(p, card)) return;
      var v = value(card, view, p, w);
      if (!best || v > best.value) best = { card: card, value: v, dist: 0 };
    });
    return best;
  }

  // 보석을 모을 목표 — 값어치가 높으면서 너무 멀지 않은 카드
  function bestTarget(view, p, w) {
    var best = null, list = boardCards(view).concat(myReserved(view, p));
    list.forEach(function (card) {
      var d = distance(p, card);
      var v = value(card, view, p, w);
      var eff = v / (1 + d * 0.5);
      if (!best || eff > best.eff) best = { card: card, value: v, dist: d, eff: eff };
    });
    return best;
  }

  /* 목표에 모자란 색부터, 없으면 값어치 높은 색부터 집는다 */
  function pickGems(view, p, w, target) {
    var want = {};
    if (target) {
      COLORS.forEach(function (c) {
        var miss = Math.max(0, (target.card.cost[c] || 0) - (p.bonus[c] || 0) - (p.gems[c] || 0));
        if (miss) want[c] = miss * 3;
      });
    }
    var avail = COLORS.filter(function (c) { return view.bank[c] > 0; });
    if (!avail.length) return null;

    var scored = avail.map(function (c) { return { c: c, v: (want[c] || 0) + w[c] }; });
    scored.sort(function (a, b) { return b.v - a.v; });

    // 정말 한 색만 급하고 그 색이 넉넉하면 두 개 집는 게 낫다
    var top = scored[0];
    if (view.bank[top.c] >= 4 && (want[top.c] || 0) >= 6 && top.v > (scored[1] ? scored[1].v * 1.7 : 0)) {
      return [top.c, top.c];
    }
    var take = scored.slice(0, Math.min(3, scored.length)).map(function (x) { return x.c; });
    return take;
  }

  /* 실력을 낮추면 가끔 아무 수나 둔다.
     '조금 덜 정교하게' 두게 만드는 것보다 이쪽이 실제로 약하다. */
  function randomAct(view, p) {
    var avail = COLORS.filter(function (c) { return view.bank[c] > 0; });
    var affordable = boardCards(view).concat(myReserved(view, p)).filter(function (c) {
      return !!R.payFor(p, c);
    });
    var roll = Math.random();
    if (affordable.length && roll < 0.45) {
      return { action: 'buy', args: [affordable[Math.floor(Math.random() * affordable.length)].id] };
    }
    if (avail.length && R.tokenCount(p) < R.MAX_TOKENS) {
      var pool = avail.slice();
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      return { action: 'takeGems', args: [pool.slice(0, Math.min(3, pool.length))] };
    }
    if (affordable.length) return { action: 'buy', args: [affordable[0].id] };
    if (p.reserved.length < R.MAX_RESERVED) {
      var open = boardCards(view);
      if (open.length) return { action: 'reserve', args: [open[Math.floor(Math.random() * open.length)].id] };
      for (var t2 = 1; t2 <= 3; t2++) if (view.deckCount[t2]) return { action: 'reserveTop', args: [t2] };
    }
    return null;
  }

  function act(view, skill) {
    var p = me(view);
    if (!p) return null;
    if (view.canPass) return { action: 'pass', args: [] };
    skill = (skill === undefined) ? 1 : skill;

    if (skill < 1 && Math.random() > skill) {
      var loose = randomAct(view, p);
      if (loose) return loose;
    }

    var w = colorWeights(view, p);
    var buy = bestBuy(view, p, w);
    var target = bestTarget(view, p, w);
    var tokens = R.tokenCount(p);
    var gems = pickGems(view, p, w, target);

    // 이번 차례에 보석을 집으면 목표에 얼마나 다가가나 — 그걸 카드 하나와 견준다
    var takeGain = 0;
    if (gems && target && target.dist > 0) {
      takeGain = target.value * Math.min(gems.length, target.dist) / target.dist * 0.9;
    }
    // 손이 꽉 찼으면 집어봐야 도로 버린다. 그럴 땐 사는 게 낫다.
    if (tokens >= R.MAX_TOKENS) takeGain *= 0.25;

    if (buy && buy.value >= takeGain) return { action: 'buy', args: [buy.card.id] };

    // 보석을 못 집거나, 노리는 3단계 카드를 남에게 뺏기기 싫을 때 킵한다
    var covet = target && target.card.tier === 3 && target.card.pts >= 4 &&
                target.dist <= 5 && view.bank[GOLD] > 0 && p.reserved.length === 0 &&
                onBoard(view, target.card.id);
    if ((!gems || covet) && p.reserved.length < R.MAX_RESERVED) {
      if (target && onBoard(view, target.card.id) && !R.payFor(p, target.card)) {
        return { action: 'reserve', args: [target.card.id] };
      }
      var any = boardCards(view)[0];
      if (any) return { action: 'reserve', args: [any.id] };
      for (var t = 3; t >= 1; t--) if (view.deckCount[t]) return { action: 'reserveTop', args: [t] };
    }

    if (gems) return { action: 'takeGems', args: [gems] };
    if (buy) return { action: 'buy', args: [buy.card.id] };
    return { action: 'pass', args: [] };
  }

  /* 넘치는 칩 버리기 — 황금은 마지막까지 쥔다 */
  function chooseDiscard(view) {
    var p = me(view), over = R.tokenCount(p) - R.MAX_TOKENS;
    if (over <= 0) return [];
    var w = colorWeights(view, p);
    var target = bestTarget(view, p, w);
    var pool = [];
    R.ALL.forEach(function (c) {
      for (var i = 0; i < p.gems[c]; i++) pool.push(c);
    });
    // 목표 카드에 아직 필요한 만큼은 남기고, 남는 것부터 버린다
    var keptFor = {};
    function keepValue(c) {
      if (c === GOLD) return 99;
      var need = target ? Math.max(0, (target.card.cost[c] || 0) - (p.bonus[c] || 0)) : 0;
      keptFor[c] = (keptFor[c] || 0) + 1;
      return (keptFor[c] <= need ? 8 : 0) + w[c];
    }
    var weighted = pool.map(function (c) { return { c: c, v: keepValue(c) }; });
    weighted.sort(function (a, b) { return a.v - b.v; });
    return weighted.slice(0, over).map(function (x) { return x.c; });
  }

  function chooseNoble(view) {
    return view.nobleChoices && view.nobleChoices.length ? view.nobleChoices[0] : null;
  }

  var API = {
    act: act, chooseDiscard: chooseDiscard, chooseNoble: chooseNoble,
    colorWeights: colorWeights, distance: distance,
    bestTarget: bestTarget, bestBuy: bestBuy, value: value      // 도우미 문구를 만들 때 쓴다
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.AI = API;
})(typeof self !== 'undefined' ? self : this);
