.PHONY: backend

backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
