import type { ItemTypeSeed } from "core";

// The Unicode "Food & Drink" group, in code-point order. Lives in `packages/web`
// rather than `core` on purpose: a list containing "Mango" and "Taco" is domain
// data, and root CLAUDE.md forbids those nouns in the domain-agnostic package.
//
// Hand-maintained rather than pulled from an emoji package — this is a fixed
// list that changes once a year at most, and a dependency would have to be
// audited and kept current for no benefit.
const ENTRIES: [emoji: string, label: string][] = [
  ["🍇", "Grapes"], ["🍈", "Melon"], ["🍉", "Watermelon"], ["🍊", "Tangerine"],
  ["🍋", "Lemon"], ["🍌", "Banana"], ["🍍", "Pineapple"], ["🥭", "Mango"],
  ["🍎", "Red apple"], ["🍏", "Green apple"], ["🍐", "Pear"], ["🍑", "Peach"],
  ["🍒", "Cherries"], ["🍓", "Strawberry"], ["🫐", "Blueberries"], ["🥝", "Kiwi"],
  ["🍅", "Tomato"], ["🫒", "Olive"], ["🥥", "Coconut"], ["🥑", "Avocado"],
  ["🍆", "Eggplant"], ["🥔", "Potato"], ["🥕", "Carrot"], ["🌽", "Corn"],
  ["🌶️", "Hot pepper"], ["🫑", "Bell pepper"], ["🥒", "Cucumber"], ["🥬", "Leafy green"],
  ["🥦", "Broccoli"], ["🧄", "Garlic"], ["🧅", "Onion"], ["🥜", "Peanuts"],
  ["🌰", "Chestnut"], ["🍞", "Bread"], ["🥐", "Croissant"], ["🥖", "Baguette"],
  ["🫓", "Flatbread"], ["🥨", "Pretzel"], ["🥯", "Bagel"], ["🥞", "Pancakes"],
  ["🧇", "Waffle"], ["🧀", "Cheese"], ["🍖", "Meat on bone"], ["🍗", "Poultry leg"],
  ["🥩", "Cut of meat"], ["🥓", "Bacon"], ["🍔", "Hamburger"], ["🍟", "Fries"],
  ["🍕", "Pizza"], ["🌭", "Hot dog"], ["🥪", "Sandwich"], ["🌮", "Taco"],
  ["🌯", "Burrito"], ["🫔", "Tamale"], ["🥙", "Stuffed flatbread"], ["🧆", "Falafel"],
  ["🥚", "Egg"], ["🍳", "Cooking"], ["🥘", "Shallow pan of food"], ["🍲", "Pot of food"],
  ["🫕", "Fondue"], ["🥣", "Bowl with spoon"], ["🥗", "Green salad"], ["🍿", "Popcorn"],
  ["🧈", "Butter"], ["🧂", "Salt"], ["🥫", "Canned food"], ["🍱", "Bento box"],
  ["🍘", "Rice cracker"], ["🍙", "Rice ball"], ["🍚", "Cooked rice"], ["🍛", "Curry rice"],
  ["🍜", "Steaming bowl"], ["🍝", "Spaghetti"], ["🍠", "Roasted sweet potato"], ["🍢", "Oden"],
  ["🍣", "Sushi"], ["🍤", "Fried shrimp"], ["🍥", "Fish cake"], ["🥮", "Moon cake"],
  ["🍡", "Dango"], ["🥟", "Dumpling"], ["🥠", "Fortune cookie"], ["🥡", "Takeout box"],
  ["🦪", "Oyster"], ["🍦", "Soft ice cream"], ["🍧", "Shaved ice"], ["🍨", "Ice cream"],
  ["🍩", "Doughnut"], ["🍪", "Cookie"], ["🎂", "Birthday cake"], ["🍰", "Shortcake"],
  ["🧁", "Cupcake"], ["🥧", "Pie"], ["🍫", "Chocolate bar"], ["🍬", "Candy"],
  ["🍭", "Lollipop"], ["🍮", "Custard"], ["🍯", "Honey pot"], ["🍼", "Baby bottle"],
  ["🥛", "Glass of milk"], ["☕", "Hot beverage"], ["🫖", "Teapot"], ["🍵", "Teacup"],
  ["🍶", "Sake"], ["🍾", "Bottle with popping cork"], ["🍷", "Wine glass"], ["🍸", "Cocktail"],
  ["🍹", "Tropical drink"], ["🍺", "Beer mug"], ["🍻", "Clinking beer mugs"], ["🥂", "Clinking glasses"],
  ["🥃", "Tumbler glass"], ["🫗", "Pouring liquid"], ["🥤", "Cup with straw"], ["🧋", "Bubble tea"],
  ["🧃", "Beverage box"], ["🧉", "Mate"], ["🧊", "Ice"],
];

/** `mango` — the default selection in the session form (Task 14). */
export const DEFAULT_ITEM_TYPE_KEY = "mango";

export const ITEM_TYPE_CATALOG: ItemTypeSeed[] = ENTRIES.map(
  ([emoji, label], position) => ({
    key: label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    emoji,
    label,
    position,
  }),
);
