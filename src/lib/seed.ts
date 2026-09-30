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
        id: "9cfd8056-2185-4516-846c-8bcaf8a8304b",
        name: "Odkamienianie ekspresu",
        icon: "Coffee",
        color: "amber",
        frequency_days: 14,
        last_done_at: daysAgo(12),
      },
      {
        id: "8ecf6c42-2c4b-4b52-a78f-637cf864e526",
        name: "Filtr wentylacji",
        icon: "Fan",
        color: "blue",
        frequency_days: 90,
        last_done_at: daysAgo(96),
      },
      {
        id: "ae7f7bd9-8972-4f5e-9266-b2ec4468b863",
        name: "Klatka królika",
        icon: "Rabbit",
        color: "violet",
        frequency_days: 4,
        last_done_at: daysAgo(1),
      },
      {
        id: "e5b99d42-e21e-44c5-9e82-9f39b9f7f39a",
        name: "Podlewanie roślin",
        icon: "Sprout",
        color: "green",
        frequency_days: 3,
        last_done_at: daysAgo(2),
      },
      {
        id: "187d9620-c589-4f3e-a7f0-9f009bfc6220",
        name: "Pranie pościeli",
        icon: "BedDouble",
        color: "teal",
        frequency_days: 21,
        last_done_at: daysAgo(9),
      },
      {
        id: "12900263-0cff-4c70-8413-1a590d703e96",
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
        id: "a7fb019f-d869-49a8-bc19-8b94d00860fd",
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
        id: "2acbcef5-7bb1-47de-80d9-4d36b839cac3",
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
        id: "827fa84f-47d7-4c4f-afeb-7a905ddfc8c1",
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
        id: "71c904c0-fb02-4615-ad87-cff21b064bd1",
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
        id: "93c354f7-5735-446c-b87d-d85c5238cd74",
        name: "Chleb",
        done: false,
        warning_dismissed: false,
        created_at: daysAgo(0),
        sort_order: 0,
      },
      {
        id: "842ad2d4-394b-43d7-9a3a-2fe507228627",
        name: "Kawa ziarnista",
        amount: "1 kg",
        done: false,
        warning_dismissed: false,
        created_at: daysAgo(1),
        sort_order: 1,
      },
    ],
    purchases: [
      {
        id: "07b4381d-9ab4-4d9c-a1d1-5a06375d987f",
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
        id: "cabff620-dcad-4379-9321-86739763d2a7",
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
        id: "59197585-609e-4bc3-85ad-66a3a20996b0",
        store: "Rossmann",
        category: "Chemia",
        total: 96.4,
        purchased_at: daysAgo(18),
        lines: [{ name: "Proszek do prania", price: 39.9 }],
      },
      {
        id: "a38aff9f-e83f-44c9-84ba-e3ce5abfe80a",
        store: "Auchan",
        category: "Dom",
        total: 341.0,
        purchased_at: daysAgo(41),
        lines: [{ name: "Filtr HVAC", price: 89.0 }],
      },
      {
        id: "41949a0c-62ef-4d83-b078-4cc8375aa3ab",
        store: "Biedronka",
        category: "Spożywcze",
        total: 210.55,
        purchased_at: daysAgo(52),
        lines: [{ name: "Spaghetti", price: 5.49 }],
      },
      {
        id: "0b10d75f-bdc2-41a8-be9e-b8ee50cfb9f9",
        store: "Lidl",
        category: "Spożywcze",
        total: 175.2,
        purchased_at: daysAgo(74),
        lines: [{ name: "Kawa ziarnista", price: 49.99 }],
      },
    ],
    tins: [],
    dismissed_suggestions: [],
  };
}
