// Synthetic destinations for offline payment tests. Not production configuration.
export const TEST_PAYMENT_CARDS = {
  "legacy": {
    "number": "0000000000425405",
    "holder": "علیرضا اولیا",
    "bank": "بلوبانک",
    "kind": "regular",
    "sort": 1
  },
  "seed1": [
    {
      "number": "0000000000425405",
      "holder": "علیرضا اولیا",
      "bank": "بلوبانک",
      "kind": "regular",
      "sort": 1
    },
    {
      "number": "0000000000122234",
      "holder": "علیرضا اولیاء",
      "bank": "بانک پاسارگاد",
      "kind": "white",
      "sort": 2
    }
  ],
  "seed2": [
    {
      "number": "0000000000355172",
      "holder": "علیرضا اولیاء",
      "bank": "بانک خاورمیانه",
      "kind": "regular",
      "sort": 3
    },
    {
      "number": "0000000000260547",
      "holder": "علیرضا اولیاء",
      "bank": "بانک شهر",
      "kind": "white",
      "sort": 4
    }
  ],
  "regularized_number": "0000000000122234"
};
