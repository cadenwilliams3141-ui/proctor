"""Neon connection helper. DATABASE_URL comes from the environment only."""

import os

import psycopg


def connect() -> psycopg.Connection:
    return psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)
