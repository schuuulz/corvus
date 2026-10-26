# Corvus: load the user's own .zshrc, then show the current branch in the
# prompt, in its graph colour.
ZDOTDIR=${CORVUS_USER_ZDOTDIR:-$HOME}
[[ -f $ZDOTDIR/.zshrc ]] && source "$ZDOTDIR/.zshrc"

corvus_prompt() {
  [[ -z ${CORVUS_BASE_PROMPT+set} ]] && CORVUS_BASE_PROMPT=$PROMPT
  local branch=$(git branch --show-current 2>/dev/null)
  if [[ -z $branch ]]; then
    PROMPT=$CORVUS_BASE_PROMPT
    return
  fi

  # Trunk green, unless the app has coloured this branch.
  local rgb="16;185;129" name color
  if read -r name color < "$CORVUS_PROMPT_FILE" 2>/dev/null && [[ $name == $branch ]]; then
    rgb=$color
  fi
  # Branch names may contain $(...) or backticks, which zsh runs when
  # PROMPT_SUBST (set by oh-my-zsh and many themes) is on. PROMPT then holds a
  # reference instead, whose expanded value is never re-evaluated.
  typeset -g corvus_branch_label=${branch//\%/%%}
  local name_ref=$corvus_branch_label
  [[ -o promptsubst ]] && name_ref='${corvus_branch_label}'
  local label="%{"$'\e'"[38;2;${rgb}m%}(${name_ref})%{"$'\e'"[0m%}"

  # "user@host repo % " becomes "user@host repo (main) % ".
  if [[ $CORVUS_BASE_PROMPT == *'%# ' ]]; then
    PROMPT="${CORVUS_BASE_PROMPT%'%# '}$label %# "
  else
    PROMPT="$CORVUS_BASE_PROMPT$label "
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd corvus_prompt
