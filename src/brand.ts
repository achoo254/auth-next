import { defineBrand } from "@achoo254/brand";
import config from "../brand.config.json" with { type: "json" };

/**
 * The product's brand (brand.config.json, schema of @achoo254/brand).
 * Pages show the tenant's display name as their brand; the product name
 * here is only the primary tenant's default display name.
 */
export const brand = defineBrand(config);
