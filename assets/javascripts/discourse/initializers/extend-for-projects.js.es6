/*jshint esversion: 6*/

import Composer from 'discourse/models/composer';
import { withPluginApi } from 'discourse/lib/plugin-api';
import computed from 'ember-addons/ember-computed-decorators';
import NavigationItem from 'discourse/components/navigation-item';
import CategoryDrop from 'discourse/components/category-drop';
import DiscoveryTopicsController from 'discourse/controllers/discovery/topics';
import TopicTrackingState from 'discourse/models/topic-tracking-state';
import { on } from 'ember-addons/ember-computed-decorators';
import ComposerEditor from 'discourse/components/composer-editor';
import DiscoveryTopics from 'discourse/controllers/discovery/topics';
import TopicView from 'discourse/views/topic';
import TopicModel from 'discourse/models/topic';
import MountWidget from 'discourse/components/mount-widget';

export default {
    name: 'extend-for-projects',
    initialize() {
        // Setting this value is what makes new topics actually able to appear in the target project
        Composer.serializeOnCreate('parent_guids');

        function fixUrls() {
            var projectGuid = null;
            var navMode = '';

            var topicsModel = Discourse.__container__.lookup('controller:discovery.topics').model;
            if (topicsModel && topicsModel.topic_list.parent_guids) {
                projectGuid = topicsModel.topic_list.parent_guids[0];
                navMode = topicsModel.navMode;
            }

            var topicModel = Discourse.__container__.lookup('controller:topic').model;
            if (topicModel && topicModel.parent_guids) {
                projectGuid = topicModel.parent_guids[0];
            }

            if (projectGuid) {
                var categoryLinks = document.querySelectorAll('.cat a, a.bullet');
                _.each(categoryLinks, link => {
                    if (!link.pathname.startsWith('/forum/')) {
                        link.pathname = '/forum/' + projectGuid + link.pathname;
                    }
                });

                var footerLinks = document.querySelectorAll('h3 a');
                _.each(footerLinks, link => {
                    if (link.id == '') {
                        if (link.pathname == '/latest') {
                            link.pathname = '/forum/' + projectGuid + link.pathname;
                        }
                        return;
                    }
                    // These links were made by the link-to helper so they need to be modified
                    // in the ember View. This seems kinda convoluted...
                    var view = Ember.View.views[link.id];
                    var href = view.get('href');
                    if (href == '/' || href == '/latest') {
                        view.set('href', '/forum/' + projectGuid); // for appearance
                        view.set('loadedParams.targetRouteName', 'projects.show');
                        view.set('loadedParams.models', [projectGuid]);
                    } else if (href == '/categories') {
                        view.set('href', '/forum/' + projectGuid + '/' + navMode);
                        view.set('loadedParams.targetRouteName', 'projects.show' + navMode.capitalize());
                        view.set('loadedParams.models', [projectGuid]);
                    }
                });
            }
        }

        withPluginApi('0.1', api => {
            api.onPageChange((url, title) => {
                Ember.run.scheduleOnce('afterRender', fixUrls);
            });
        });

        TopicView.reopen({
            domChange: function() {
                Ember.run.scheduleOnce('afterRender', fixUrls);
            }.on('didInsertElement')
        });

        TopicModel.reopen({
            updateFromJson(json) {
                this._super(json);
                Ember.run.scheduleOnce('afterRender', fixUrls);
            }
        });

        // After "mounting"/rendering of the topic/poststream "widget"
        MountWidget.reopen({
            afterRender() {
                this._super();
                fixUrls();
            }
        });

        CategoryDrop.reopen({
            actions: {
                expand: function() {
                    this._super();
                    Ember.run.scheduleOnce('afterRender', fixUrls);
                },
            },
        });

        DiscoveryTopics.reopen({
            actions: {
                // This schedules a rerender, so we need to also schedule
                // DOM updating
                toggleBulkSelect() {
                    this._super();
                    Ember.run.scheduleOnce('afterRender', fixUrls);
                },
            }
        });

        // Make the navigation (latest, new, unread) buttons
        // more robust in determining if they are active since our routes/filterModes
        // will start with /forum/:project_guid
        NavigationItem.reopen({
            @computed("content.filterMode", "filterMode")
            active(contentFilterMode, filterMode) {
              return contentFilterMode === filterMode ||
                     contentFilterMode.indexOf(filterMode) !== -1;
            },
        });

        // Have to make the extraction of the navigation mode more robust.
        // (basically just use navMode instead of filter)
        DiscoveryTopicsController.reopen({
            showMoreUrl(period) {
                let url = '';
                if (this.get('model.filter').startsWith('forum')) {
                    url = '/forum/' + this.get('model.topic_list').parent_guids[0];
                }
                let category = this.get('category');
                if (category) {
                    url += '/c/' + Discourse.Category.slugFor(category) + (this.get('noSubcategories') ? '/none' : '') + '/l';
                }
                url += '/top/' + period;
                return url;
            },

            footerMessage: function() {
                if (!this.get('allLoaded')) { return; }

                const category = this.get('category');
                if (category) {
                    return I18n.t('topics.bottom.category', { category: category.get('name') });
                } else {
                    const split = (this.get('model.navMode') || this.get('model.filter') || '').split('/');
                    if (this.get('model.topics.length') === 0) {
                        return I18n.t("topics.none." + split[0], { category: split[1] });
                    } else {
                        return I18n.t("topics.bottom." + split[0], { category: split[1] });
                    }
                }
            }.property('allLoaded', 'model.topics.length'),

            footerEducation: function() {
                if (!this.get('allLoaded') || this.get('model.topics.length') > 0 || !Discourse.User.current()) { return; }

                const split = (this.get('model.navMode') || this.get('model.filter') || '').split('/');

                if (split[0] !== 'new' && split[0] !== 'unread') { return; }

                return I18n.t("topics.none.educate." + split[0], {
                    userPrefsUrl: Discourse.getURL("/users/") + (Discourse.User.currentProp("username_lower")) + "/preferences"
                });
            }.property('allLoaded', 'model.topics.length')
        });

        // Filter some messages by the project_guid to avoid irrelevant notifications
        // Only serve latest and new_topic notifications for the correct projects
        TopicTrackingState.reopen({
            notify(data) {
                if ((data.message_type != 'latest' && data.message_type != 'new_topic') ||
                     (data.payload.project_guid && data.payload.project_guid == this.project_guid)) {
                    this._super();
                }
            },
        });

        var contributorSearch = function(term) {
            var topicModel = Discourse.__container__.lookup('controller:topic').model;
            var contributors = topicModel.contributors;
            contributors = contributors.filter(c => {
                return c.username.toLowerCase().startsWith(term.toLowerCase()) ||
                       c.name.toLowerCase().startsWith(term.toLowerCase());
            });

            var results = contributors;
            results.users = contributors.copy();
            results.groups = [];
            return results;
        };

        // Patch so that only contributors are listed for @mentions
        ComposerEditor.reopen({
            @on('didInsertElement')
            _composerEditorInit() {
                this._super();

                const template = this.container.lookup('template:user-selector-autocomplete.raw');
                const $input = this.$('.d-editor-input');
                $input.autocomplete('destroy');
                $input.autocomplete({
                    template,
                    dataSource: term => contributorSearch(term),
                    key: "@",
                    transformComplete: v => v.username || v.name
                });
            }
        });
    }
};
