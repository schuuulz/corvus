# Corvus: ZDOTDIR points at these shims only so zsh runs Corvus's .zshrc.
# Load the user's own .zshenv, then come back here for .zshrc.
CORVUS_ZDOTDIR=$ZDOTDIR
ZDOTDIR=${CORVUS_USER_ZDOTDIR:-$HOME}
[[ -f $ZDOTDIR/.zshenv ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR=$CORVUS_ZDOTDIR
