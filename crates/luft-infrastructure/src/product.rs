use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductConfig {
    pub schema_version: u16,
    pub name: String,
    pub short_name: String,
    pub identifier: String,
    pub data_directory: String,
}

#[must_use]
pub fn product_config() -> &'static ProductConfig {
    static CONFIG: OnceLock<ProductConfig> = OnceLock::new();
    CONFIG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../product.json"))
            .expect("product.json is validated during the build")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn central_product_configuration_is_valid() {
        let product = product_config();
        assert_eq!(product.schema_version, 1);
        assert_eq!(product.name, "Luftify");
    }
}
