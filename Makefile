# 人間向けの入口。実装は npm scripts と scripts/ にある。
# CI は npm を直接叩くので、ここに実装を書かないこと。
.DEFAULT_GOAL := help
.PHONY: help setup test lint new regen verify fetch ics editions

help: ## このヘルプを表示する
	@grep -hE '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo ''
	@echo '  HANDLE / KIND を取るターゲット:'
	@echo '    make new HANDLE=ome PREF=tokyo KIND=pdf'
	@echo '    make regen HANDLE=ome'
	@echo '    make verify HANDLE=ome'
	@echo ''
	@echo '  はじめての人は CONTRIBUTING.md を読んでください。'

setup: ## 依存を入れる
	npm ci

test: ## 全ゲート (schema + extractor 静的検査 + ESLint + 単体テスト)
	npm test

lint: ## ESLint だけ実行する
	npm run lint

new: ## 新自治体の足場を作る (HANDLE= PREF= KIND= 必須)
	@test -n "$(HANDLE)" || { echo 'HANDLE= が要る 例: make new HANDLE=ome PREF=tokyo KIND=pdf'; exit 1; }
	@test -n "$(PREF)" || { echo 'PREF= が要る (municipalities/ のディレクトリ名)'; exit 1; }
	@test -n "$(KIND)" || { echo 'KIND= が要る (html|pdf|csv|txt|api)'; exit 1; }
	npm run new -- --handle $(HANDLE) --pref $(PREF) --kind $(KIND)

regen: ## 再生成して差分ゼロを確認する (HANDLE 省略で cache のある全自治体)
	npm run regen -- $(HANDLE)

verify: ## その自治体の verify を実行する (HANDLE= 必須)
	@test -n "$(HANDLE)" || { echo 'HANDLE= が要る 例: make verify HANDLE=ome'; exit 1; }
	@f=$$(find tools -path "*/$(HANDLE)/verify.mjs" | head -1); \
	  test -n "$$f" || { echo "verify.mjs が無い: $(HANDLE)"; exit 1; }; \
	  node "$$f"

fetch: ## 一次ソースを取得する (HANDLE= 必須。cache を作り直すときに使う)
	@test -n "$(HANDLE)" || { echo 'HANDLE= が要る 例: make fetch HANDLE=ome'; exit 1; }
	@f=$$(find tools -path "*/$(HANDLE)/fetch.mjs" | head -1); \
	  test -n "$$f" || { echo "fetch.mjs が無い: $(HANDLE)"; exit 1; }; \
	  node "$$f" $(ARGS)

ics: ## .ics と stats を生成する
	npm run build:ics

editions: ## 次の版が公開されたか確認する
	npm run check:editions
