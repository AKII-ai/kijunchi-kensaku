/**
 * 「よく使うもの」の入口。検索対象を狭めるものではない。
 * 法令IDは、e-Gov 法令API の検索で確認済みのものだけを書く。推測して足さない。足し方は docs/法令を足す.md。
 */

export const FEATURED = [
  {
    name: "土壌汚染対策法",
    laws: [
      { law_id: "414AC0000000053", title: "土壌汚染対策法", type_label: "法律" },
      { law_id: "414CO0000000336", title: "土壌汚染対策法施行令", type_label: "政令" },
      { law_id: "414M60001000029", title: "土壌汚染対策法施行規則", type_label: "省令" },
    ],
  },
  {
    name: "水質汚濁防止法",
    laws: [
      { law_id: "345AC0000000138", title: "水質汚濁防止法", type_label: "法律" },
      { law_id: "346CO0000000188", title: "水質汚濁防止法施行令", type_label: "政令" },
      { law_id: "346M50000402002", title: "水質汚濁防止法施行規則", type_label: "省令" },
    ],
  },
  {
    name: "下水道法",
    laws: [
      { law_id: "333AC0000000079", title: "下水道法", type_label: "法律" },
      { law_id: "334CO0000000147", title: "下水道法施行令", type_label: "政令" },
      { law_id: "342M50004000037", title: "下水道法施行規則", type_label: "省令" },
    ],
  },
];
