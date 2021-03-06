import RestModel from 'discourse/models/rest';
import Topic from 'discourse/models/topic';
import { throwAjaxError } from 'discourse/lib/ajax-error';

const CLOSED = 'closed',
      SAVING = 'saving',
      OPEN = 'open',
      DRAFT = 'draft',

      // The actions the composer can take
      CREATE_TOPIC = 'createTopic',
      PRIVATE_MESSAGE = 'privateMessage',
      REPLY = 'reply',
      EDIT = 'edit',
      REPLY_AS_NEW_TOPIC_KEY = "reply_as_new_topic",

      // When creating, these fields are moved into the post model from the composer model
      _create_serializer = {
        raw: 'reply',
        title: 'title',
        category: 'categoryId',
        topic_id: 'topic.id',
        is_warning: 'isWarning',
        archetype: 'archetypeId',
        target_usernames: 'targetUsernames'
      },

      _edit_topic_serializer = {
        title: 'topic.title',
        categoryId: 'topic.category.id'
      };

const Composer = RestModel.extend({

  archetypes: function() {
    return this.site.get('archetypes');
  }.property(),

  creatingTopic: Em.computed.equal('action', CREATE_TOPIC),
  creatingPrivateMessage: Em.computed.equal('action', PRIVATE_MESSAGE),
  notCreatingPrivateMessage: Em.computed.not('creatingPrivateMessage'),

  privateMessage: function(){
    return this.get('creatingPrivateMessage') || this.get('topic.archetype') === 'private_message';
  }.property('creatingPrivateMessage', 'topic'),

  topicFirstPost: Em.computed.or('creatingTopic', 'editingFirstPost'),

  editingPost: Em.computed.equal('action', EDIT),
  replyingToTopic: Em.computed.equal('action', REPLY),

  viewOpen: Em.computed.equal('composeState', OPEN),
  viewDraft: Em.computed.equal('composeState', DRAFT),

  archetype: function() {
    return this.get('archetypes').findProperty('id', this.get('archetypeId'));
  }.property('archetypeId'),

  archetypeChanged: function() {
    return this.set('metaData', Em.Object.create());
  }.observes('archetype'),

  editingFirstPost: Em.computed.and('editingPost', 'post.firstPost'),
  canEditTitle: Em.computed.or('creatingTopic', 'creatingPrivateMessage', 'editingFirstPost'),
  canCategorize: Em.computed.and('canEditTitle', 'notCreatingPrivateMessage'),

  // Determine the appropriate title for this action
  actionTitle: function() {
    const topic = this.get('topic');

    let postLink, topicLink;
    if (topic) {
      const postNumber = this.get('post.post_number');
      postLink = "<a href='" + (topic.get('url')) + "/" + postNumber + "'>" +
        I18n.t("post.post_number", { number: postNumber }) + "</a>";
      topicLink = "<a href='" + (topic.get('url')) + "'> " + (Handlebars.Utils.escapeExpression(topic.get('title'))) + "</a>";
    }

    let postDescription;
    const post = this.get('post');

    if (post) {
      postDescription = I18n.t('post.' +  this.get('action'), {
        link: postLink,
        replyAvatar: Discourse.Utilities.tinyAvatar(post.get('avatar_template')),
        username: this.get('post.username')
      });

      if (!Discourse.Mobile.mobileView) {
        const replyUsername = post.get('reply_to_user.username');
        const replyAvatarTemplate = post.get('reply_to_user.avatar_template');
        if (replyUsername && replyAvatarTemplate && this.get('action') === EDIT) {
          postDescription += " <i class='fa fa-mail-forward reply-to-glyph'></i> " + Discourse.Utilities.tinyAvatar(replyAvatarTemplate) + " " + replyUsername;
        }
      }
    }

    switch (this.get('action')) {
      case PRIVATE_MESSAGE: return I18n.t('topic.private_message');
      case CREATE_TOPIC: return I18n.t('topic.create_long');
      case REPLY:
      case EDIT:
        if (postDescription) return postDescription;
        if (topic) return I18n.t('post.reply_topic', { link: topicLink });
    }

  }.property('action', 'post', 'topic', 'topic.title'),

  toggleText: function() {
    return this.get('showPreview') ? I18n.t('composer.hide_preview') : I18n.t('composer.show_preview');
  }.property('showPreview'),

  hidePreview: Em.computed.not('showPreview'),

  // whether to disable the post button
  cantSubmitPost: function() {

    // can't submit while loading
    if (this.get('loading')) return true;

    // title is required when
    //  - creating a new topic/private message
    //  - editing the 1st post
    if (this.get('canEditTitle') && !this.get('titleLengthValid')) return true;

    // reply is always required
    if (this.get('missingReplyCharacters') > 0) return true;

    if (this.get("privateMessage")) {
      // need at least one user when sending a PM
      return this.get('targetUsernames') && (this.get('targetUsernames').trim() + ',').indexOf(',') === 0;
    } else {
      // has a category? (when needed)
      return this.get('canCategorize') &&
            !this.siteSettings.allow_uncategorized_topics &&
            !this.get('categoryId') &&
            !this.user.get('staff');
    }
  }.property('loading', 'canEditTitle', 'titleLength', 'targetUsernames', 'replyLength', 'categoryId', 'missingReplyCharacters'),

  titleLengthValid: function() {
    if (this.user.get('admin') && this.get('post.static_doc') && this.get('titleLength') > 0) return true;
    if (this.get('titleLength') < this.get('minimumTitleLength')) return false;
    return (this.get('titleLength') <= this.siteSettings.max_topic_title_length);
  }.property('minimumTitleLength', 'titleLength', 'post.static_doc'),

  // The icon for the save button
  saveIcon: function () {
    switch (this.get('action')) {
      case EDIT: return '<i class="fa fa-pencil"></i>';
      case REPLY: return '<i class="fa fa-reply"></i>';
      case CREATE_TOPIC: return '<i class="fa fa-plus"></i>';
      case PRIVATE_MESSAGE: return '<i class="fa fa-envelope"></i>';
    }
  }.property('action'),

  // The text for the save button
  saveText: function() {
    switch (this.get('action')) {
      case EDIT: return I18n.t('composer.save_edit');
      case REPLY: return I18n.t('composer.reply');
      case CREATE_TOPIC: return I18n.t('composer.create_topic');
      case PRIVATE_MESSAGE: return I18n.t('composer.create_pm');
    }
  }.property('action'),

  hasMetaData: function() {
    const metaData = this.get('metaData');
    return metaData ? Em.isEmpty(Em.keys(this.get('metaData'))) : false;
  }.property('metaData'),

  /**
    Did the user make changes to the reply?

    @property replyDirty
  **/
  replyDirty: function() {
    return this.get('reply') !== this.get('originalText');
  }.property('reply', 'originalText'),

  /**
    Number of missing characters in the title until valid.

    @property missingTitleCharacters
  **/
  missingTitleCharacters: function() {
    return this.get('minimumTitleLength') - this.get('titleLength');
  }.property('minimumTitleLength', 'titleLength'),

  /**
    Minimum number of characters for a title to be valid.

    @property minimumTitleLength
  **/
  minimumTitleLength: function() {
    if (this.get('privateMessage')) {
      return this.siteSettings.min_private_message_title_length;
    } else {
      return this.siteSettings.min_topic_title_length;
    }
  }.property('privateMessage'),

  missingReplyCharacters: function() {
    const postType = this.get('post.post_type');
    if (postType === this.site.get('post_types.small_action')) { return 0; }
    return this.get('minimumPostLength') - this.get('replyLength');
  }.property('minimumPostLength', 'replyLength'),

  /**
    Minimum number of characters for a post body to be valid.

    @property minimumPostLength
  **/
  minimumPostLength: function() {
    if( this.get('privateMessage') ) {
      return this.siteSettings.min_private_message_post_length;
    } else if (this.get('topicFirstPost')) {
      // first post (topic body)
      return this.siteSettings.min_first_post_length;
    } else {
      return this.siteSettings.min_post_length;
    }
  }.property('privateMessage', 'topicFirstPost'),

  /**
    Computes the length of the title minus non-significant whitespaces

    @property titleLength
  **/
  titleLength: function() {
    const title = this.get('title') || "";
    return title.replace(/\s+/img, " ").trim().length;
  }.property('title'),

  /**
    Computes the length of the reply minus the quote(s) and non-significant whitespaces

    @property replyLength
  **/
  replyLength: function() {
    let reply = this.get('reply') || "";
    while (Discourse.Quote.REGEXP.test(reply)) { reply = reply.replace(Discourse.Quote.REGEXP, ""); }
    return reply.replace(/\s+/img, " ").trim().length;
  }.property('reply'),

  _setupComposer: function() {
    const val = (Discourse.Mobile.mobileView ? false : (Discourse.KeyValueStore.get('composer.showPreview') || 'true'));
    this.set('showPreview', val === 'true');
    this.set('archetypeId', this.site.get('default_archetype'));
  }.on('init'),

  /**
    Append text to the current reply

    @method appendText
    @param {String} text the text to append
  **/
  appendText(text,position,opts) {
    const reply = (this.get('reply') || '');
    position = typeof(position) === "number" ? position : reply.length;

    let before = reply.slice(0, position) || '';
    let after = reply.slice(position) || '';

    let stripped, i;
    if (opts && opts.block){
      if (before.trim() !== ""){
        stripped = before.replace(/\r/g, "");
        for(i=0; i<2; i++){
          if(stripped[stripped.length - 1 - i] !== "\n"){
            before += "\n";
            position++;
          }
        }
      }
      if(after.trim() !== ""){
        stripped = after.replace(/\r/g, "");
        for(i=0; i<2; i++){
          if(stripped[i] !== "\n"){
            after = "\n" + after;
          }
        }
      }
    }

    if(opts && opts.space){
      if(before.length > 0 && !before[before.length-1].match(/\s/)){
        before = before + " ";
      }
      if(after.length > 0 && !after[0].match(/\s/)){
        after = " " + after;
      }
    }

    this.set('reply', before + text + after);

    return before.length + text.length;
  },

  togglePreview() {
    this.toggleProperty('showPreview');
    Discourse.KeyValueStore.set({ key: 'composer.showPreview', value: this.get('showPreview') });
  },

  applyTopicTemplate: function() {
    if (this.get('action') !== CREATE_TOPIC) { return; }
    if (!Ember.isEmpty(this.get('reply'))) { return; }

    const categoryId = this.get('categoryId');
    const category = this.site.categories.find((c) => c.get('id') === categoryId);
    if (category) {
      const topicTemplate = category.get('topic_template');
      if (!Ember.isEmpty(topicTemplate)) {
        this.set('reply', topicTemplate);
      }
    }

  }.observes('categoryId'),

  /*
     Open a composer

     opts:
       action   - The action we're performing: edit, reply or createTopic
       post     - The post we're replying to, if present
       topic    - The topic we're replying to, if present
       quote    - If we're opening a reply from a quote, the quote we're making
  */
  open(opts) {
    if (!opts) opts = {};
    this.set('loading', false);

    const replyBlank = Em.isEmpty(this.get("reply"));

    const composer = this;
    if (!replyBlank &&
        (opts.action !== this.get('action') || ((opts.reply || opts.action === this.EDIT) && this.get('reply') !== this.get('originalText'))) &&
        !opts.tested) {
      opts.tested = true;
      return;
    }

    if (!opts.draftKey) throw 'draft key is required';
    if (opts.draftSequence === null) throw 'draft sequence is required';

    this.setProperties({
      draftKey: opts.draftKey,
      draftSequence: opts.draftSequence,
      composeState: opts.composerState || OPEN,
      action: opts.action,
      topic: opts.topic,
      targetUsernames: opts.usernames
    });

    if (opts.post) {
      this.set('post', opts.post);
      if (!this.get('topic')) {
        this.set('topic', opts.post.get('topic'));
      }
    }

    const categoryId = opts.categoryId || this.get('topic.category.id');
    this.setProperties({
      categoryId,
      archetypeId: opts.archetypeId || this.site.get('default_archetype'),
      metaData: opts.metaData ? Em.Object.create(opts.metaData) : null,
      reply: opts.reply || this.get("reply") || ""
    });

    if (opts.postId) {
      this.set('loading', true);
      this.store.find('post', opts.postId).then(function(post) {
        composer.set('post', post);
        composer.set('loading', false);
      });
    }

    // If we are editing a post, load it.
    if (opts.action === EDIT && opts.post) {

      const topicProps = this.serialize(_edit_topic_serializer);
      topicProps.loading = true;

      this.setProperties(topicProps);

      this.store.find('post', opts.post.get('id')).then(function(post) {
        composer.setProperties({
          reply: post.get('raw'),
          originalText: post.get('raw'),
          loading: false
        });
      });
    } else if (opts.action === REPLY && opts.quote) {
      this.setProperties({
        reply: opts.quote,
        originalText: opts.quote
      });
    }
    if (opts.title) { this.set('title', opts.title); }
    this.set('originalText', opts.draft ? '' : this.get('reply'));

    return false;
  },

  save(opts) {
    if (!this.get('cantSubmitPost')) {
      return this.get('editingPost') ? this.editPost(opts) : this.createPost(opts);
    }
  },

  /**
    Clear any state we have in preparation for a new composition.

    @method clearState
  **/
  clearState() {
    this.setProperties({
      originalText: null,
      reply: null,
      post: null,
      title: null,
      editReason: null,
      stagedPost: false
    });
  },

  // When you edit a post
  editPost(opts) {
    const post = this.get('post'),
          oldCooked = post.get('cooked'),
          self = this;

    let promise;

    // Update the title if we've changed it, otherwise consider it a
    // successful resolved promise
    if (this.get('title') &&
        post.get('post_number') === 1 &&
        this.get('topic.details.can_edit')) {
      const topicProps = this.getProperties(Object.keys(_edit_topic_serializer));

       promise = Topic.update(this.get('topic'), topicProps);
    } else {
      promise = Ember.RSVP.resolve();
    }

    const props = {
      raw: this.get('reply'),
      edit_reason: opts.editReason,
      image_sizes: opts.imageSizes,
      cooked: this.getCookedHtml()
    };

    this.set('composeState', CLOSED);

    return promise.then(function() {
      return post.save(props).then(function(result) {
        self.clearState();
        return result;
      }).catch(throwAjaxError(function() {
        post.set('cooked', oldCooked);
        self.set('composeState', OPEN);
      }));
    });
  },

  serialize(serializer, dest) {
    dest = dest || {};
    Object.keys(serializer).forEach(f => {
      const val = this.get(serializer[f]);
      if (typeof val !== 'undefined') {
        Ember.set(dest, f, val);
      }
    });
    return dest;
  },

  // Create a new Post
  createPost(opts) {
    const post = this.get('post'),
          topic = this.get('topic'),
          user = this.user,
          postStream = this.get('topic.postStream');

    let addedToStream = false;

    // Build the post object
    const createdPost = this.store.createRecord('post', {
      imageSizes: opts.imageSizes,
      cooked: this.getCookedHtml(),
      reply_count: 0,
      name: user.get('name'),
      display_username: user.get('name'),
      username: user.get('username'),
      user_id: user.get('id'),
      user_title: user.get('title'),
      uploaded_avatar_id: user.get('uploaded_avatar_id'),
      user_custom_fields: user.get('custom_fields'),
      post_type: this.site.get('post_types.regular'),
      actions_summary: [],
      moderator: user.get('moderator'),
      admin: user.get('admin'),
      yours: true,
      read: true,
      wiki: false
    });

    this.serialize(_create_serializer, createdPost);

    if (post) {
      createdPost.setProperties({
        reply_to_post_number: post.get('post_number'),
        reply_to_user: {
          username: post.get('username'),
          uploaded_avatar_id: post.get('uploaded_avatar_id')
        }
      });
    }

    let state = null;

    // If we're in a topic, we can append the post instantly.
    if (postStream) {
      // If it's in reply to another post, increase the reply count
      if (post) {
        post.set('reply_count', (post.get('reply_count') || 0) + 1);
        post.set('replies', []);
      }

      // We do not stage posts in mobile view, we do not have the "cooked"
      // Furthermore calculating cooked is very complicated, especially since
      // we would need to handle oneboxes and other bits that are not even in the
      // engine, staging will just cause a blank post to render
      if (!_.isEmpty(createdPost.get('cooked'))) {
        state = postStream.stagePost(createdPost, user);
        if (state === "alreadyStaging") { return; }
      }
    }

    const composer = this;
    composer.set('composeState', SAVING);
    composer.set("stagedPost", state === "staged" && createdPost);

    return createdPost.save().then(function(result) {
      let saving = true;

      if (result.responseJson.action === "enqueued") {
        if (postStream) { postStream.undoPost(createdPost); }
        return result;
      }

      if (topic) {
        // It's no longer a new post
        topic.set('draft_sequence', result.target.draft_sequence);
        postStream.commitPost(createdPost);
        addedToStream = true;
      } else {
        // We created a new topic, let's show it.
        composer.set('composeState', CLOSED);
        saving = false;

        // Update topic_count for the category
        const category = composer.site.get('categories').find(function(x) { return x.get('id') === (parseInt(createdPost.get('category'),10) || 1); });
        if (category) category.incrementProperty('topic_count');
        Discourse.notifyPropertyChange('globalNotice');
      }

      composer.clearState();
      composer.set('createdPost', createdPost);

      if (addedToStream) {
        composer.set('composeState', CLOSED);
      } else if (saving) {
        composer.set('composeState', SAVING);
      }

      return result;
    }).catch(throwAjaxError(function() {
      if (postStream) {
        postStream.undoPost(createdPost);
      }
      Ember.run.next(() => composer.set('composeState', OPEN));
    }));
  },

  getCookedHtml() {
    return $('#reply-control .wmd-preview').html().replace(/<span class="marker"><\/span>/g, '');
  },

  saveDraft() {
    // Do not save when drafts are disabled
    if (this.get('disableDrafts')) return;
    // Do not save when there is no reply
    if (!this.get('reply')) return;
    // Do not save when the reply's length is too small
    if (this.get('replyLength') < this.siteSettings.min_post_length) return;

    const data = {
      reply: this.get('reply'),
      action: this.get('action'),
      title: this.get('title'),
      categoryId: this.get('categoryId'),
      postId: this.get('post.id'),
      archetypeId: this.get('archetypeId'),
      metaData: this.get('metaData'),
      usernames: this.get('targetUsernames')
    };

    this.set('draftStatus', I18n.t('composer.saving_draft_tip'));

    const composer = this;

    // try to save the draft
    return Discourse.Draft.save(this.get('draftKey'), this.get('draftSequence'), data)
      .then(function() {
        composer.set('draftStatus', I18n.t('composer.saved_draft_tip'));
      }).catch(function() {
        composer.set('draftStatus', I18n.t('composer.drafts_offline'));
      });
  }

});

Composer.reopenClass({

  open(opts) {
    const composer = Composer.create();
    composer.open(opts);
    return composer;
  },

  loadDraft(opts) {
    opts = opts || {};

    let draft = opts.draft;
    const draftKey = opts.draftKey;
    const draftSequence = opts.draftSequence;

    try {
      if (draft && typeof draft === 'string') {
        draft = JSON.parse(draft);
      }
    } catch (error) {
      draft = null;
      Discourse.Draft.clear(draftKey, draftSequence);
    }
    if (draft && ((draft.title && draft.title !== '') || (draft.reply && draft.reply !== ''))) {
      return this.open({
        draftKey,
        draftSequence,
        action: draft.action,
        title: draft.title,
        categoryId: draft.categoryId || opts.categoryId,
        postId: draft.postId,
        archetypeId: draft.archetypeId,
        reply: draft.reply,
        metaData: draft.metaData,
        usernames: draft.usernames,
        draft: true,
        composerState: DRAFT
      });
    }
  },

  create(args) {
    args = args || {};
    args.user = args.user || Discourse.User.current();
    args.site = args.site || Discourse.Site.current();
    args.siteSettings = args.siteSettings || Discourse.SiteSettings;
    return this._super(args);
  },

  serializeToTopic(fieldName, property) {
    if (!property) { property = fieldName; }
    _edit_topic_serializer[fieldName] = property;
  },

  serializeOnCreate(fieldName, property) {
    if (!property) { property = fieldName; }
    _create_serializer[fieldName] = property;
  },

  serializedFieldsForCreate() {
    return Object.keys(_create_serializer);
  },

  // The status the compose view can have
  CLOSED,
  SAVING,
  OPEN,
  DRAFT,

  // The actions the composer can take
  CREATE_TOPIC,
  PRIVATE_MESSAGE,
  REPLY,
  EDIT,

  // Draft key
  REPLY_AS_NEW_TOPIC_KEY
});

export default Composer;
