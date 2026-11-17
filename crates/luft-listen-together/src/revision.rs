#[must_use]
pub fn should_apply_revision(incoming: u64, last_applied: u64) -> bool {
    incoming > last_applied
}

#[cfg(test)]
mod tests {
    use super::should_apply_revision;

    #[test]
    fn older_or_equal_revisions_are_dropped() {
        assert!(should_apply_revision(150, 149));
        assert!(!should_apply_revision(149, 150));
        assert!(!should_apply_revision(150, 150));
        assert!(should_apply_revision(1, 0));
    }
}
