# Contributing to _Cosmos_
We want to make contributing to this project as easy and transparent as possible.

## Code of Conduct
cosmos.gl has a Code of Conduct that we expect project participants to adhere
to. Please read [the full text](https://github.com/cosmos.gl/graph/CODE_OF_CONDUCT.md) so that you can understand
what actions will and will not be tolerated.

## Our Development Process
We use Storybook to simplify the development process. You can start it by running `npm run storybook` in the root directory.
If you've added a new feature, changed the configuration or public methods, please add a new example with its source code to Storybook if applicable and suggest changes to the docs.
For non-trivial changes, consider adding a short note in `history/` to capture **why** the change happened.
Use `history/README.md` for guidance, `history/PROMPT.md` to draft it with any LLM, or run `/history <why>` in Claude Code to let it gather context and write the file automatically.

## Pull Requests
We actively welcome pull requests. If you want to submit one, please follow the following process:

1. Fork the repo and create your branch from `main`;
2. Code;
3. Make sure the project lints and builds after your changes;
4. Submit your PR!

## License
By contributing to _Cosmos_, you agree that your contributions will be licensed its MIT license.
