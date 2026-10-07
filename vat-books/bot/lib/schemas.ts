import { z } from "zod";

export const salesInput = {
  bin: z.string(),
  lineId: z.string().describe("lineId from the 6.1 purchase book"),
  count: z.number().int().min(1).describe("How many customers to sell to"),
  quantityPerSale: z.number().positive(),
  unitPrice: z.number().positive().describe("BDT per unit, excluding tax"),
  issueDate: z.string().describe("YYYY-MM-DD"),
  vatRate: z.number().min(0).max(100).optional().describe("Defaults to 15"),
  sdRate: z.number().min(0).max(1000).optional().describe("Defaults to 0"),
};
