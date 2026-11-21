.PHONY: help install build test test-watch lint lint-fix format format-check qa example-invoice example-info example-history example-static-wallet example-webhook example-balance example-payout example-payout-info example-services example-rates example-refund example-aml-links webhook-inspect docker-build docker-shell docker-webhook docker-qa clean

NODE ?= node
NPM  ?= npm

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	$(NPM) install

build: ## Compile TypeScript to dist/
	$(NPM) run build

test: ## Run all unit tests (builds first)
	$(NPM) test

test-watch: ## Re-run tests on file change
	$(NPM) run test:watch

lint: ## Run ESLint
	$(NPM) run lint

lint-fix: ## Run ESLint with autofix
	$(NPM) run lint:fix

format: ## Apply Prettier
	$(NPM) run format

format-check: ## Fail if any file would be reformatted
	$(NPM) run format:check

qa: ## Run all quality gates (lint + format + test)
	$(NPM) run qa

example-invoice: build ## Create a test invoice via the API
	$(NODE) dist/examples/01-create-invoice.js

example-info: build ## Look up payment info (pass UUID env var)
	$(NODE) dist/examples/02-get-payment-info.js $(UUID)

example-history: build ## List recent payments
	$(NODE) dist/examples/03-list-payment-history.js

example-static-wallet: build ## Create a static (top-up) wallet
	$(NODE) dist/examples/04-create-static-wallet.js

example-webhook: build ## Run the webhook handler on http://localhost:8000
	$(NODE) dist/examples/05-handle-webhook.js

example-balance: build ## Show merchant + personal balances
	$(NODE) dist/examples/06-get-balance.js

example-payout: build ## Create a payout (pass AMOUNT and ADDRESS env vars)
	$(NODE) dist/examples/07-create-payout.js $(AMOUNT) $(ADDRESS)

example-payout-info: build ## Look up a payout (pass UUID env var)
	$(NODE) dist/examples/08-get-payout-info.js $(UUID)

example-services: build ## List payment or payout services (KIND=payment|payout)
	$(NODE) dist/examples/09-list-services.js $(KIND)

example-rates: build ## List exchange rates (CURRENCY=USD by default)
	$(NODE) dist/examples/10-exchange-rates.js $(CURRENCY)

example-refund: build ## Refund an invoice via the payout key (pass UUID and ADDRESS env vars)
	$(NODE) dist/examples/11-refund.js $(UUID) $(ADDRESS)

example-aml-links: build ## Fetch AML links for a blocked payment (pass UUID env var)
	$(NODE) dist/examples/12-aml-links.js $(UUID)

webhook-inspect: build ## Pipe a webhook payload into the inspector CLI (pass KEY env var)
	$(NODE) dist/bin/heleket-webhook-inspect.js --key=$(KEY)

docker-build: ## Build the dev Docker image
	docker compose build

docker-shell: ## Open a shell in the dev container
	docker compose run --rm cli sh

docker-webhook: ## Run the webhook handler in Docker on port 8000
	docker compose up webhook

docker-qa: ## Run the QA pipeline in Docker
	docker compose run --rm qa

clean: ## Remove generated artifacts
	rm -rf dist coverage .eslintcache
