# Pull Request

## 📋 Description
<!-- Provide a clear and concise description of what this PR does -->


## 🔗 Related Issue
<!-- Link to the issue this PR addresses -->
Fixes #<!-- issue number -->

## 🎯 Type of Change
<!-- Check the box that applies to this PR -->
- [ ] 🐛 **Bug fix** (non-breaking change that fixes an issue)
- [ ] ✨ **New feature** (non-breaking change that adds functionality)
- [ ] 💥 **Breaking change** (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📚 **Documentation update** (changes to documentation only)
- [ ] 🔧 **Refactor** (code change that neither fixes a bug nor adds a feature)
- [ ] ⚡ **Performance improvement** (code change that improves performance)
- [ ] 🧪 **Test update** (adding missing tests or correcting existing tests)
- [ ] 🔨 **Build/CI** (changes to build process or CI configuration)
- [ ] 🎨 **Style** (formatting, missing semicolons, etc; no code change)

## 🚀 Version Impact
<!-- This will help determine the automatic version bump -->
- [ ] **MAJOR** - Breaking changes that require `!` in commit message (e.g., `feat!:` or `fix!:`)
- [ ] **MINOR** - New features, bug fixes, or improvements (e.g., `feat:`, `fix:`, `docs:`)
- [ ] **No version bump** - Internal changes only

## 📝 Commit Message Preview
<!-- Preview of your commit message using conventional commits format -->
```
<type>[optional scope]: <description>

[optional body explaining the change]

[optional footer with breaking changes]
```

**Example:**
```
feat(editor): add multi-cursor support

Added ability to place multiple cursors for simultaneous editing.
Includes keyboard shortcuts Ctrl+D and Ctrl+Shift+L.

Closes #123
```

## 🧪 Testing
<!-- Describe how you tested your changes -->
- [ ] Manual testing completed
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] No tests needed (documentation/styling changes)

### Test Steps
<!-- Provide step-by-step instructions to test the changes -->
1.
2.
3.

## 📸 Screenshots/Videos
<!-- If applicable, add screenshots or videos to help explain your changes -->


## ⚠️ Breaking Changes
<!-- If this is a breaking change, describe what breaks and how to migrate -->
**⚠️ IMPORTANT:** This PR contains breaking changes!

### What breaks:
-

### How to migrate:
-

### Documentation updated:
- [ ] API documentation
- [ ] Migration guide
- [ ] Changelog entry

## ✅ Checklist
<!-- Check all that apply -->
- [ ] Code follows the project's coding guidelines
- [ ] Self-review of code completed
- [ ] Changes have been tested locally
- [ ] Unit tests pass locally
- [ ] Integration tests pass locally
- [ ] Documentation updated (if needed)
- [ ] Commit message follows [conventional commits](https://conventionalcommits.org/) format
- [ ] No sensitive information (passwords, keys, etc.) included
- [ ] All TODOs and FIXMEs addressed or documented

## 📦 Dependencies
<!-- List any new dependencies this PR introduces -->
- [ ] No new dependencies
- [ ] New dependencies added (list below):

### New Dependencies:
<!-- If applicable, list new dependencies and justify their inclusion -->
- **Package Name** (`version`) - Brief justification

## 🔍 Code Review Notes
<!-- Any specific areas you'd like reviewers to focus on -->


## 📚 Additional Context
<!-- Add any other context about the PR here -->


---

### 🤖 For Maintainers

**Merge Guidelines:**
- Ensure commit messages follow conventional commits format
- Squash commits if multiple commits address the same logical change
- Use appropriate commit type for automatic versioning:
  - `feat:` for new features (MINOR bump)
  - `fix:` for bug fixes (MINOR bump)
  - `feat!:` or `fix!:` for breaking changes (MAJOR bump)
  - `docs:`, `chore:`, `style:`, etc. for other changes (MINOR bump)

**Version Impact:** This PR will result in a **[MAJOR/MINOR/PATCH]** version bump when merged to main.

---

<!--
Thank you for contributing to Alpexium IDE!

📖 Please read our contribution guidelines before submitting.
🎯 Ensure your changes align with the project's goals and coding standards.
🔄 Keep your branch up-to-date with the main branch.
-->

## 🎉 Ready for Review
- [ ] This PR is ready for review
- [ ] This PR is a work in progress (WIP)
