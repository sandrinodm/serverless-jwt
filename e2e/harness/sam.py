"""Invoke the pinned SAM entry point with documented Werkzeug request-log configuration."""
import importlib.metadata
import logging
import sys

from samcli.cli.main import cli

if importlib.metadata.version('aws-sam-cli') != '1.171.0':
    raise RuntimeError('SAM must use the reviewed exact version 1.171.0')

# Werkzeug documents this named logger for INFO access records. Keep its WARNING/errors,
# every other SAM logger, and all Lambda/application stdout/stderr unchanged.
logging.getLogger('werkzeug').setLevel(logging.WARNING)
if __name__ == '__main__':
    sys.argv[0] = 'sam'
    sys.exit(cli())
