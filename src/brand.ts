import { defineBrand } from "@shared-next/brand";
import config from "../brand.config.json" with { type: "json" };

/**
 * The product's brand (brand.config.json, schema of @shared-next/brand).
 * Pages show the tenant's display name as their brand; the product name
 * here is only the primary tenant's default display name.
 */
export const brand = defineBrand(config);
