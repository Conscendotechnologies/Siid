# Salesforce Intelligence Integrated Development (siid)

[![Feature Requests](https://img.shields.io/github/issues/sfdxpert/AIpexium2/feature-request.svg)](https://github.com/sfdxpert/AIpexium2/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
[![Bugs](https://img.shields.io/github/issues/sfdxpert/AIpexium2/bug.svg)](https://github.com/sfdxpert/AIpexium2/issues?utf8=✓&q=is%3Aissue+is%3Aopen+label%3Abug)

## The Repository

This repository is a fork of [Microsoft's Visual Studio Code](https://github.com/microsoft/vscode) where we (Conscendo) develop the Salesforce Intelligence Integrated Development product together with the community. Not only do we work on code and issues here, we also publish our roadmap, monthly iteration plans, and endgame plans.

**Original Project:** This project is based on Visual Studio Code, which is available under the standard [MIT license](https://github.com/microsoft/vscode/blob/main/LICENSE.txt).

## Salesforce Intelligence Integrated Development

<p align="center">
  <img width="960" height="564" alt="Screenshot 2025-10-14 112353" src="https://github.com/user-attachments/assets/c27faca7-5c89-4ec4-ab65-2b31184ba312" />
</p>

Salesforce Intelligence Integrated Development (siid) is a specialized distribution based on the `Code - OSS` repository, customized for Salesforce development workflows and intelligence features.

siid combines the simplicity of a code editor with what developers need for their core edit-build-debug cycle. It provides comprehensive code editing, navigation, and understanding support along with lightweight debugging, a rich extensibility model, and lightweight integration with existing tools - specifically optimized for Salesforce development.

## Contributing

There are many ways in which you can participate in this project, for example:

* [Submit bugs and feature requests](https://github.com/sfdxpert/AIpexium2/issues), and help us verify as they are checked in
* Review [source code changes](https://github.com/sfdxpert/AIpexium2/pulls)
* Review the documentation and make pull requests for anything from typos to additional and new content

If you are interested in fixing issues and contributing directly to the code base, please see the document [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute), which covers the following:

* How to build and run from source
* The development workflow, including debugging and running tests
* Coding guidelines
* Submitting pull requests
* Finding an issue to work on

## Feedback

* [Request a new feature](https://github.com/sfdxpert/AIpexium2/issues/new?labels=feature-request)
* Upvote [popular feature requests](https://github.com/sfdxpert/AIpexium2/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
* [File an issue](https://github.com/sfdxpert/AIpexium2/issues)
* Connect with us on [GitHub Discussions](https://github.com/sfdxpert/AIpexium2/discussions)

## Related Projects

Many of the core components and extensions live in their own repositories on GitHub. This project builds upon the extensive VS Code ecosystem. For the original VS Code related projects, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page.

## Bundled Extensions

siid includes a set of built-in extensions located in the [extensions](extensions) folder, including grammars and snippets for many languages. Extensions that provide rich language support (code completion, Go to Definition) for a language have the suffix `language-features`. For example, the `json` extension provides coloring for `JSON` and the `json-language-features` extension provides rich language support for `JSON`.

## Development Container

This repository includes a Visual Studio Code Dev Containers / GitHub Codespaces development container.

* For [Dev Containers](https://aka.ms/vscode-remote/download/containers), use the **Dev Containers: Clone Repository in Container Volume...** command which creates a Docker volume for better disk I/O on macOS and Windows.
  * If you already have VS Code and Docker installed, you can also click [here](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/sfdxpert/AIpexium2) to get started. This will cause VS Code to automatically install the Dev Containers extension if needed, clone the source code into a container volume, and spin up a dev container for use.

* For Codespaces, install the [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) extension in VS Code, and use the **Codespaces: Create New Codespace** command.

Docker / the Codespace should have at least **4 Cores and 6 GB of RAM (8 GB recommended)** to run full build. See the [development container README](.devcontainer/README.md) for more information.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License

**Original Visual Studio Code:**
Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the [MIT](LICENSE.txt) license.

**This Fork (Salesforce Intelligence Integrated Development):**
Copyright (c) 2025 Conscendo. All rights reserved.
Licensed under the [MIT](LICENSE.txt) license.

This project is a fork of [Visual Studio Code](https://github.com/microsoft/vscode) and maintains the original MIT License. All modifications and additions are also released under the MIT License.

