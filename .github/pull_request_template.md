# Pull Request

## 🎉 PR Status
<!-- Check one -->
- [ ] ✅ Ready for review
- [ ] 🚧 Work in progress (WIP) - Draft PR

## 📋 Description
<!-- Provide a clear and concise description of what this PR does -->


## 🔗 Related Issue
<!-- Link to the issue this PR addresses -->
Fixes #<!-- issue number -->

<!-- If this is part of a larger effort, link related PRs -->
**Related PRs:**
- #<!-- PR number -->

## 🎯 Type of Change
<!-- Check all that apply to this PR -->
- [ ] 🐛 **Bug fix** (non-breaking change that fixes an issue)
- [ ] ✨ **New feature** (non-breaking change that adds functionality)
- [ ] 💥 **Breaking change** (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📚 **Documentation update** (changes to documentation only)
- [ ] 🔧 **Refactor** (code change that neither fixes a bug nor adds a feature)
- [ ] ⚡ **Performance improvement** (code change that improves performance)
- [ ] 🧪 **Test update** (adding missing tests or correcting existing tests)
- [ ] 🔨 **Build/CI** (changes to build process or CI configuration)
- [ ] 🎨 **Style** (formatting, missing semicolons, etc; no code change)

## 📝 Commit Message Preview
<!-- Preview of your commit message using conventional commits format -->
```
<type>[optional scope]: <description>

[optional body explaining the change]

[optional footer with breaking changes or issue references]
```

**Example:**
```
feat(editor): add multi-cursor support

Added ability to place multiple cursors for simultaneous editing.
Includes keyboard shortcuts Ctrl+D and Ctrl+Shift+L.

Closes #123
```

**Conventional Commit Types & Version Impact:**
- `feat:` - New feature → **MINOR** version bump
- `fix:` - Bug fix → **PATCH** version bump
- `feat!:` or `fix!:` - Breaking change → **MAJOR** version bump
- `docs:`, `style:`, `refactor:`, `test:`, `chore:` - Other changes → **PATCH** version bump or no bump
- Use `!` after type for any breaking change (e.g., `refactor!:`)

## 🧪 Testing
<!-- Describe how you tested your changes -->
- [ ] Manual testing completed
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] All existing tests pass
- [ ] No tests needed (documentation/styling changes only)

### Test Coverage
<!-- Optional: Provide step-by-step instructions to test the changes, or describe test scenarios -->


## 📸 Screenshots/Videos
<!-- If applicable, add screenshots or videos to help explain your changes -->


## ⚠️ Breaking Changes
<!-- Only fill this section if you checked "Breaking change" above -->

**⚠️ IMPORTANT:** This PR contains breaking changes!

### What breaks:
-

### How to migrate:
-

### Rollback plan:
<!-- How to revert if issues are discovered after deployment -->
-

### Documentation updated:
- [ ] API documentation
- [ ] Migration guide
- [ ] Changelog entry
- [ ] README updated

## ⚡ Performance Impact
<!-- Optional: Describe any performance implications (positive or negative) -->
- [ ] No performance impact
- [ ] Performance improved (describe below)
- [ ] Performance may be affected (describe below)

**Details:**


## 📦 Dependencies
<!-- List any new dependencies this PR introduces -->
- [ ] No new dependencies
- [ ] Dependencies updated (list below)
- [ ] New dependencies added (list below)

### New/Updated Dependencies:
<!-- If applicable, list dependencies and justify their inclusion -->
- **Package Name** (`version`) - Brief justification

## ✅ Checklist
<!-- Check all that apply -->
- [ ] Code follows the project's coding guidelines
- [ ] Self-review of code completed
- [ ] Changes have been tested locally
- [ ] All tests pass locally
- [ ] Documentation updated (if needed)
- [ ] Commit message follows [conventional commits](https://conventionalcommits.org/) format
- [ ] No sensitive information (passwords, keys, etc.) included
- [ ] All TODOs and FIXMEs addressed or documented
- [ ] Code is properly commented (where needed)
- [ ] No console.log or debug code left in

## 🔍 Code Review Notes
<!-- Any specific areas you'd like reviewers to focus on, or known limitations -->


## 📚 Additional Context
<!-- Add any other context about the PR here, including design decisions, alternatives considered, etc. -->


---

### 🤖 For Maintainers

**Merge Guidelines:**
- Ensure commit messages follow conventional commits format
- Squash commits if multiple commits address the same logical change
- Verify appropriate commit type for automatic versioning
- Confirm all CI checks pass before merging
- Review breaking changes carefully and ensure migration path is clear

**Expected Version Impact:** This PR will result in a **[MAJOR/MINOR/PATCH/NONE]** version bump when merged to main.

---

<!--
Thank you for contributing to Alpexium IDE!

📖 Please read our contribution guidelines before submitting.
🎯 Ensure your changes align with the project's goals and coding standards.
🔄 Keep your branch up-to-date with the main branch.
💬 Respond to review feedback promptly.
🙏 Be respectful and constructive in all discussions.
-->
