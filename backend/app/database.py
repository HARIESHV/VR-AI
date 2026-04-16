import os

from dotenv import load_dotenv
from fastapi import HTTPException, status
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
# Fix for SQLAlchemy connecting to psycopg 3 driver while using the standard connection string
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
    
engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True) if DATABASE_URL else None
if engine:
    print("✅ NEON DATABASE IS ACTIVE AND CONNECTED!")
SessionLocal = (
    sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True) if engine else None
)


def get_db():
    if SessionLocal is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server database is not configured. Set DATABASE_URL in backend .env.",
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
