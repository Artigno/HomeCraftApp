import type { HomeSyncState } from "./api/types";

function daysAgo(n: number) {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export function createSeedState(): HomeSyncState {
  return {
    tasks: [
      {
        id: "t1",
        name: "Odkamienianie ekspresu",
        icon: "Coffee",
        color: "amber",
        frequency_days: 14,
        last_done_at: daysAgo(12),
      },
      {
        id: "t2",
        name: "Filtr wentylacji",
        icon: "Fan",
        color: "blue",
        frequency_days: 90,
        last_done_at: daysAgo(96),
      },
      {
        id: "t3",
        name: "Klatka królika",
        icon: "Rabbit",
        color: "violet",
        frequency_days: 4,
        last_done_at: daysAgo(1),
      },
      {
        id: "t4",
        name: "Podlewanie roślin",
        icon: "Sprout",
        color: "green",
        frequency_days: 3,
        last_done_at: daysAgo(2),
      },
      {
        id: "t5",
        name: "Pranie pościeli",
        icon: "BedDouble",
        color: "teal",
        frequency_days: 21,
        last_done_at: daysAgo(9),
      },
      {
        id: "t6",
        name: "Przegląd auta",
        icon: "Car",
        color: "red",
        frequency_days: 180,
        last_done_at: daysAgo(210),
      },
    ],
    logs: [],
    recipes: [
      {
        id: "r1",
        title: "Naleśniki",
        emoji: "🥞",
        tags: ["Szybka kolacja", "Słodkie"],
        prep_minutes: 20,
        servings: 4,
        ingredients: [
          { name: "Mleko", amount: "500 ml" },
          { name: "Mąka pszenna", amount: "300 g" },
          { name: "Jajka", amount: "3 szt." },
          { name: "Masło", amount: "30 g" },
          { name: "Cukier", amount: "1 łyżka" },
        ],
        steps: [
          "Wymieszaj mąkę, jajka i mleko na gładkie ciasto.",
          "Odstaw na 10 minut.",
          "Smaż na rozgrzanej patelni po 1 minucie z każdej strony.",
        ],
      },
      {
        id: "r2",
        title: "Makaron carbonara",
        emoji: "🍝",
        tags: ["Szybka kolacja", "Obiad"],
        prep_minutes: 25,
        servings: 2,
        ingredients: [
          { name: "Spaghetti", amount: "250 g" },
          { name: "Boczek", amount: "150 g" },
          { name: "Jajka", amount: "2 szt." },
          { name: "Parmezan", amount: "60 g" },
          { name: "Pieprz", amount: "do smaku" },
        ],
        steps: [
          "Ugotuj makaron al dente.",
          "Podsmaż boczek na złoto.",
          "Połącz z jajkami i parmezanem poza ogniem.",
        ],
      },
      {
        id: "r3",
        title: "Zupa pomidorowa",
        emoji: "🍲",
        tags: ["Obiad", "Comfort food"],
        prep_minutes: 40,
        servings: 4,
        ingredients: [
          { name: "Passata pomidorowa", amount: "700 g" },
          { name: "Śmietana 18%", amount: "200 ml" },
          { name: "Ryż", amount: "150 g" },
          { name: "Bulion warzywny", amount: "1 l" },
        ],
        steps: ["Zagotuj bulion z passatą.", "Dopraw i zabiel śmietaną.", "Podaj z ryżem."],
      },
      {
        id: "r4",
        title: "Sałatka grecka",
        emoji: "🥗",
        tags: ["Lekkie", "Bez gotowania"],
        prep_minutes: 10,
        servings: 2,
        ingredients: [
          { name: "Pomidory", amount: "3 szt." },
          { name: "Ogórek", amount: "1 szt." },
          { name: "Feta", amount: "200 g" },
          { name: "Oliwki", amount: "100 g" },
        ],
        steps: ["Pokrój warzywa.", "Dodaj fetę i oliwki.", "Skrop oliwą i wymieszaj."],
      },
    ],
    shopping: [
      {
        id: "s1",
        name: "Chleb",
        done: false,
        warning_dismissed: false,
        created_at: daysAgo(0),
      },
      {
        id: "s2",
        name: "Kawa ziarnista",
        amount: "1 kg",
        done: false,
        warning_dismissed: false,
        created_at: daysAgo(1),
      },
    ],
    purchases: [
      {
        id: "p1",
        store: "Biedronka",
        category: "Spożywcze",
        total: 184.32,
        purchased_at: daysAgo(2),
        lines: [
          { name: "Mleko", price: 4.19 },
          { name: "Jajka", price: 12.99 },
          { name: "Masło", price: 8.49 },
        ],
      },
      {
        id: "p2",
        store: "Lidl",
        category: "Spożywcze",
        total: 232.1,
        purchased_at: daysAgo(9),
        lines: [
          { name: "Pomidory", price: 9.99 },
          { name: "Feta", price: 7.49 },
        ],
      },
      {
        id: "p3",
        store: "Rossmann",
        category: "Chemia",
        total: 96.4,
        purchased_at: daysAgo(18),
        lines: [{ name: "Proszek do prania", price: 39.9 }],
      },
      {
        id: "p4",
        store: "Auchan",
        category: "Dom",
        total: 341.0,
        purchased_at: daysAgo(41),
        lines: [{ name: "Filtr HVAC", price: 89.0 }],
      },
      {
        id: "p5",
        store: "Biedronka",
        category: "Spożywcze",
        total: 210.55,
        purchased_at: daysAgo(52),
        lines: [{ name: "Spaghetti", price: 5.49 }],
      },
      {
        id: "p6",
        store: "Lidl",
        category: "Spożywcze",
        total: 175.2,
        purchased_at: daysAgo(74),
        lines: [{ name: "Kawa ziarnista", price: 49.99 }],
      },
    ],
    dismissed_suggestions: [],
  };
}
