@echo off
setlocal

if not defined PGHOST set "PGHOST=localhost"
if not defined PGPORT set "PGPORT=5432"
if not defined PGUSER set "PGUSER=postgres"

where psql >nul 2>&1
if errorlevel 1 (
    echo ERROR: psql was not found on PATH. Add the PostgreSQL bin directory to PATH.
    exit /b 1
)

echo This will permanently drop and recreate the PostgreSQL database "ekip".
echo Other databases and the PostgreSQL data directory will not be changed.
choice /C YN /N /M "Continue? [Y/N] "
if errorlevel 2 exit /b 0

echo.
echo Dropping the ekip database...
psql -v ON_ERROR_STOP=1 -U "%PGUSER%" -d postgres -c "DROP DATABASE IF EXISTS ekip WITH (FORCE);"
if errorlevel 1 goto :error

echo Creating the ekip database...
psql -v ON_ERROR_STOP=1 -U "%PGUSER%" -d postgres -c "CREATE DATABASE ekip;"
if errorlevel 1 goto :error

echo Applying Prisma migrations...
pushd "%~dp0apps\backend"
if errorlevel 1 goto :error
call npx prisma migrate deploy --schema src/prisma/schema.prisma
if errorlevel 1 (
    popd
    goto :error
)
popd

echo.
echo The ekip database was recreated and migrations were applied.
echo Uploaded files and Qdrant indexes were not changed.
exit /b 0

:error
echo.
echo ERROR: Database reset did not complete. Review the output above.
exit /b 1
