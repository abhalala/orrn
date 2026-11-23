/**
 * XE PLATFORM row 83: the OpenAPI 3.1 document served at `/api/v1/openapi.json`. Plain data (no builder), so the
 * module costs nothing until the API loads. `test/platform-api.test.ts` checks every route of `ROUTES` is here and
 * nothing else is.
 */
const str = { type: "string" } as const;
const strN = { type: ["string", "null"] } as const;
const int = { type: "integer" } as const;
const intN = { type: ["integer", "null"] } as const;

const pageParams = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "cursor", in: "query", schema: str, description: "The nextCursor of the previous page." },
];
const idParam = { name: "id", in: "path", required: true, schema: str };

const errors = {
  "401": { description: "No token, or it is not valid, revoked or expired.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "403": { description: "The token lacks the scope, or the module is off.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "429": { description: "More than 60 calls in a minute for this token. See Retry-After.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

const pageOf = (ref: string) => ({
  type: "object",
  required: ["data", "nextCursor"],
  properties: { data: { type: "array", items: { $ref: ref } }, nextCursor: strN },
});
const one = (ref: string) => ({ type: "object", required: ["data"], properties: { data: { $ref: ref } } });
const ok = (schema: unknown) => ({ "200": { description: "OK", content: { "application/json": { schema } } }, ...errors });

const op = (summary: string, scope: string, schema: unknown, parameters: unknown[] = []) => ({
  get: { summary, security: [{ bearer: [scope] }], "x-orrn-scope": scope, parameters, responses: ok(schema) },
});

export const API_OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "orrn plant API",
    version: "1",
    description:
      "Read-only access to one plant's orders, stock, dispatches and invoices. Weights are in grams, lengths in millimetres, money in paise. Rates and amounts appear only for tokens with the prices.read scope.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "A plant API token: orrna_<id>_<secret>." } },
    schemas: {
      Error: { type: "object", properties: { error: { type: "object", properties: { code: str, message: str } } } },
      Order: {
        type: "object",
        properties: {
          id: str, number: str, status: str, customerId: str, customerName: str, poNumber: strN, orderDate: str, expectedDate: strN,
          lines: int, orderedG: int, producedG: int, dispatchedG: int, balanceG: int, lateDays: intN,
        },
      },
      OrderLine: {
        type: "object",
        properties: {
          id: str, lineNo: int, sectionId: str, sectionCode: str, sectionName: strN, cutLengthMm: int, finish: strN,
          orderedG: int, orderedPcs: intN, producedG: int, dispatchedG: int, balanceG: int,
          ratePaise: { ...intN, description: "Rate per kg in paise. Only with prices.read." },
        },
      },
      OrderDetail: {
        type: "object",
        properties: {
          id: str, number: str, status: str, customerId: str, customerName: str, poNumber: strN, orderDate: str, expectedDate: strN, lateDays: intN,
          lines: { type: "array", items: { $ref: "#/components/schemas/OrderLine" } },
        },
      },
      StockRow: {
        type: "object",
        properties: { sectionId: str, sectionCode: str, sectionName: strN, lengthMm: int, bundles: int, pcs: int, weightG: int, reservedBundles: int, oldestAt: strN },
      },
      StockLocation: {
        type: "object",
        properties: { locationId: strN, code: strN, name: strN, bundles: int, pcs: int, weightG: int, reservedBundles: int, sections: int },
      },
      Dispatch: {
        type: "object",
        properties: {
          id: str, code: str, status: str, shipDay: strN, completedAt: strN, packingListNumber: strN, vehicleNo: strN, invoiceNumber: strN,
          customerId: str, customerName: str, orderId: strN, orderNumber: strN, bundles: int, pcs: int, weightG: int,
        },
      },
      DispatchDetail: {
        type: "object",
        properties: {
          id: str, code: str, status: str, shipDay: strN, completedAt: strN, vehicleNo: strN, invoiceNumber: strN, customerId: str, customerName: strN,
          packingList: { type: ["object", "null"], properties: { id: str, number: str, revision: int, createdAt: strN } },
          bundles: {
            type: "array",
            items: {
              type: "object",
              properties: { id: str, serial: str, sectionId: str, sectionCode: str, lengthMm: int, pcs: int, weightG: int, orderId: strN, orderNumber: strN, lineNo: intN, poNumber: strN },
            },
          },
        },
      },
      Invoice: {
        type: "object",
        properties: {
          id: str, kind: str, status: str, number: strN, invoiceDate: strN, customerId: str, weightG: intN, irnStatus: strN,
          taxablePaise: { ...intN, description: "Only with prices.read." },
          totalPaise: { ...intN, description: "Only with prices.read." },
        },
      },
      InvoiceDetail: {
        type: "object",
        properties: {
          id: str, kind: str, status: str, number: strN, invoiceDate: strN, customerId: str, againstInvoiceId: strN,
          irn: { type: "object", properties: { status: strN, irn: strN, ackNo: strN, ackDate: strN } },
          ewayBill: { type: "object", properties: { status: strN, number: strN, validUntil: strN } },
          packingLists: { type: "array", items: { type: "object", properties: { id: strN, number: strN, revision: intN } } },
          outstandingPaise: { ...intN, description: "Only with prices.read." },
          paidPaise: { ...intN, description: "Only with prices.read." },
          creditedPaise: { ...intN, description: "Only with prices.read." },
        },
      },
    },
  },
  paths: {
    "/api/v1/orders": op("Sales orders, newest first", "orders.read", pageOf("#/components/schemas/Order"), [
      ...pageParams,
      { name: "status", in: "query", schema: str },
      { name: "customerId", in: "query", schema: str },
      { name: "from", in: "query", schema: { type: "string", format: "date" } },
      { name: "to", in: "query", schema: { type: "string", format: "date" } },
    ]),
    "/api/v1/orders/{id}": op("One order with its lines and their status", "orders.read", one("#/components/schemas/OrderDetail"), [idParam]),
    "/api/v1/stock": op("Stock in the yard by section and cut length", "stock.read", pageOf("#/components/schemas/StockRow"), [
      ...pageParams,
      { name: "sectionId", in: "query", schema: str },
    ]),
    "/api/v1/stock/locations": op("Stock in the yard by location", "stock.read", pageOf("#/components/schemas/StockLocation"), [
      { name: "sectionId", in: "query", schema: str },
    ]),
    "/api/v1/dispatches": op("Dispatches, newest first", "dispatch.read", pageOf("#/components/schemas/Dispatch"), [
      ...pageParams,
      { name: "status", in: "query", schema: str },
      { name: "customerId", in: "query", schema: str },
    ]),
    "/api/v1/dispatches/{id}": op("One dispatch with its bundles and packing list", "dispatch.read", one("#/components/schemas/DispatchDetail"), [idParam]),
    "/api/v1/invoices": op("Tax invoices and credit notes (billing on). Pages reach 200 rows; narrow with from and to.", "invoices.read", pageOf("#/components/schemas/Invoice"), [
      ...pageParams,
      { name: "status", in: "query", schema: str },
      { name: "customerId", in: "query", schema: str },
      { name: "from", in: "query", schema: { type: "string", format: "date" } },
      { name: "to", in: "query", schema: { type: "string", format: "date" } },
    ]),
    "/api/v1/invoices/{id}": op("One invoice", "invoices.read", one("#/components/schemas/InvoiceDetail"), [idParam]),
  },
  webhooks: {
    event: {
      post: {
        summary:
          "Events order.confirmed, dispatch.done, invoice.issued, stock.adjusted. Header x-orrn-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, \"<t>.<raw body>\")>. Answer 2xx; others are retried for 24 h.",
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { id: str, event: str, createdAt: str, data: { type: "object" } } },
            },
          },
        },
        responses: { "200": { description: "Received" } },
      },
    },
  },
} as const;
