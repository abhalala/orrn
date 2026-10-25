/** Native-only strings for the office Orders screens (apps/native). Top-level keys become `native.<key>.*`. Keep en and hi identical in shape. */
export const ordersEn = {
  orders: {
    lineOf: "Line {n} of {total}",
    review: "Review",
    toReview: "Review the order",
    changeDie: "Change die",
    incomplete: "Not complete",
  },
} as const;
