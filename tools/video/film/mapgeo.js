// Здания на карте в координатах SVG-карты приложения (0..128, y вниз). Копия BUILDINGS из docs/dotamap.js:
// при смене карты в патче править в обоих местах. Ключи как в боевом логе: npc_dota_<сторона>_<ключ>.
export const BUILDINGS = {
  goodguys: {
    tower1_top: [14.5, 49.5], tower2_top: [14.9, 70.8], tower3_top: [12.5, 90.6],
    tower1_mid: [51.9, 75], tower2_mid: [36.6, 85.8], tower3_mid: [27.8, 96.4],
    tower1_bot: [102.5, 111.5], tower2_bot: [61.2, 112.9], tower3_bot: [33.1, 111.8],
    melee_rax_top: [10.4, 94], range_rax_top: [14.8, 94],
    melee_rax_mid: [24.3, 95.8], range_rax_mid: [27.4, 99.6],
    melee_rax_bot: [30.6, 109.7], range_rax_bot: [30.6, 114],
    tower4: [[19.4, 102], [21.9, 104.6]], fort: [16.6, 107.6],
  },
  badguys: {
    tower1_top: [24.1, 18.3], tower2_top: [63, 17], tower3_top: [91.8, 18.9],
    tower1_mid: [68.1, 58.9], tower2_mid: [83.5, 47.5], tower3_mid: [97.4, 34.6],
    tower1_bot: [113, 77.4], tower2_bot: [114, 61], tower3_bot: [113.5, 40.3],
    melee_rax_top: [95.4, 16.6], range_rax_top: [95.4, 21],
    melee_rax_mid: [100.6, 32.4], range_rax_mid: [97.6, 28.6],
    melee_rax_bot: [117.6, 37.6], range_rax_bot: [113.2, 37.6],
    tower4: [[103.3, 24.6], [106.4, 27.4]], fort: [110.4, 21.2],
  },
};
