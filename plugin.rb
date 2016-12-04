# name: discourse-osf-projects
# about: Introduces the concept of projects or sub-sites that can be either public or private
# version: 0.1
# authors: Acshi Haggenmiller
register_asset 'stylesheets/osf-projects.scss'
register_asset 'javascripts/discourse/templates/projects/index.hbs', :server_side
register_asset 'javascripts/discourse/templates/projects/show.hbs', :server_side

require 'pry'

after_initialize do
    PARENT_GUIDS_FIELD_NAME = 'parent_guids'
    PROJECT_GUID_FIELD_NAME = 'project_guid' # DB use only: equivalent to parent_guids[0]
    TOPIC_GUID_FIELD_NAME = 'topic_guid'
    PARENT_NAMES_FIELD_NAME = 'parent_names'
    VIEW_ONLY_KEYS_FIELD_NAME = 'view_only_keys'

    module ::OsfProjects
        class Engine < ::Rails::Engine
            engine_name 'osf_projects'
            isolate_namespace OsfProjects
        end

        def self.clean_guid(guid)
            guid.downcase.gsub(/[^a-z0-9]/, '')
        end

        def self.preload_parent_groups(topics)
            topics.preload_funcs ||= []
            topics.preload_funcs <<= Proc.new do |association, records|
                parent_guidss = association.map {|t| t.parent_guids}.flatten.uniq
                next if parent_guidss.length == 0
                parent_groupss = Group.where(name: parent_guidss).preload(:group_custom_fields).to_a

                records.each do |t|
                    t.parent_groups = t.parent_guids.map {|guid| parent_groupss.select {|group| group.name == guid }.first}
                end
            end
            topics
        end

        def self.preload_parent_names(topics)
            topics.preload_funcs ||= []
            topics.preload_funcs <<= Proc.new do |association, records|
                parent_guidss = association.map {|t| t.parent_guids}.flatten.uniq

                # If the only parent topic is the current topic, no need to query DB
                if parent_guidss.length == 1 && records.any? { |t| t.topic_guid == parent_guidss[0] }
                    topic_name = records.select { |t| t.topic_guid == parent_guidss[0] }.first.title
                    records.each do |t|
                        t.parent_names = [topic_name]
                    end
                    next
                end
                next if parent_guidss.length == 0

                parent_topicss = Topic.select('title, tc.value as t_guid')
                                 .joins('LEFT JOIN topic_custom_fields AS tc ON (topics.id = tc.topic_id)')
                                 .references('tc')
                                 .where('tc.name = ? AND tc.value IN (?)', TOPIC_GUID_FIELD_NAME, parent_guidss)
                                 .to_a

                records.each do |t|
                    t.parent_names = t.parent_guids.map do |guid|
                        parent_topic = parent_topicss.select {|topic| topic.t_guid == guid }.first
                        parent_topic.title if parent_topic
                    end
                end
            end
            topics
        end

        def self.topics_for_guids(guids)
            topics = Topic.joins('LEFT JOIN topic_custom_fields AS tc ON (topics.id = tc.topic_id)')
                            .references('tc')
                            .where('tc.name = ? AND tc.value IN (?)', TOPIC_GUID_FIELD_NAME, guids)

            topics = topics.preload(:topic_custom_fields)
            topics = topics.preload(:excerpt_post)
            topics = OsfProjects::preload_parent_groups(topics)
            topics = OsfProjects::preload_parent_names(topics)

            topics.to_a.uniq { |t| t.topic_guid }
        end

        def self.topic_for_guid(guid)
            topics_for_guids([guid].flatten)[0]
        end

        # guids is passed for ORDER of the array
        # if that guid does not have a topic, it does not appear in output
        # returned are the arrays of the names and guids actually present in the topics
        def self.names_guids_for_topics(guids, topics)
            return nil unless guids
            names = guids.map do |guid|
                topic = topics.select { |t| t.topic_guid == guid }[0]
                topic ? topic.title : nil
            end
            compact_guids = names.each_with_index.map do |name, i|
                guids[i] if name
            end
            [names.compact, compact_guids.compact]
        end

        def self.can_create_project_topic(project_guid, user)
            return false if user == nil
            return true if user.staff?
            result = Group.select(1).joins(:group_users).where('groups.name = ? AND group_users.user_id = ?', project_guid, user.id)
            result.to_a.length > 0
        end

        def self.can_create_topic_in_project(project_group, user)
            return false if user == nil
            return true if user.staff?
            project_group.group_users.any? {|gu| gu.user_id == user.id}
        end

        def self.can_view(topic, view_only_id)
            topic.parent_groups[0].group_custom_fields.any? { |gcf| gcf.name == VIEW_ONLY_KEYS_FIELD_NAME && gcf.value.include?("-#{view_only_id}-") }
        end

        def self.filter_viewable_topics(topics, user, view_only_id=nil)
            topics.select { |t| t.project_is_public || can_create_topic_in_project(t.parent_groups[0], user) || can_view(t, view_only_id)}
        end

        def self.allowed_project_topics(topics, user)
            return topics if user && user.staff?
            # a visible group is a public one
            allowed_project_guids = Group.select(:name)
                                         .joins('INNER JOIN group_users AS gu ON groups.id = gu.group_id')
                                         .where((user ? 'gu.user_id = :user_id OR ' : '') + "groups.visible = 't'",
                                                 user_id: user ? user.id : nil)
            topics.joins('LEFT JOIN topic_custom_fields AS tc ON topics.id = tc.topic_id')
                  .where("tc.name = ? AND tc.value IN (#{allowed_project_guids.to_sql})", PROJECT_GUID_FIELD_NAME)
        end

        def self.allowed_project_posts(posts, user)
            return posts if user && user.staff?
            # a visible group is a public one
            allowed_project_guids = Group.select(:name)
                                         .joins('INNER JOIN group_users AS gu ON groups.id = gu.group_id')
                                         .where((user ? 'gu.user_id = :user_id OR ' : '') + "groups.visible = 't'",
                                                 user_id: user ? user.id : nil)
            posts.joins('LEFT JOIN topic_custom_fields AS tc ON posts.topic_id = tc.topic_id')
                  .where("tc.name = ? AND tc.value IN (#{allowed_project_guids.to_sql})", PROJECT_GUID_FIELD_NAME)
        end

        def self.filter_to_project(project_guid, topics)
            topics.joins('LEFT JOIN topic_custom_fields AS tc2 ON (topics.id = tc2.topic_id)')
                  .where('tc2.name = ? AND tc2.value LIKE ?', PARENT_GUIDS_FIELD_NAME, "%-#{project_guid}-%")
        end

        def self.contributors_for_project(project_guid)
            User.select(:username, :name, :uploaded_avatar_id)
                .joins('LEFT JOIN group_users AS gu ON (users.id = gu.user_id)')
                .joins('LEFT JOIN groups AS g ON (g.id = gu.group_id)')
                .where("g.name = '#{project_guid}'")
                .to_a.map do |user|
                {
                    username: user.username,
                    name: user.name,
                    avatar_template: User.avatar_template(user.username, user.uploaded_avatar_id)
                }
            end
        end
    end

    ActiveRecord::Relation.class_eval do
        attr_accessor :preload_funcs

        old_exec_queries = self.instance_method(:exec_queries)
        define_method(:exec_queries) do |&block|
            records = old_exec_queries.bind(self).call(&block)
            if preload_funcs
                preload_funcs.each do |func|
                    func.call(self, records)
                end
            end
            records
        end
    end

    # Allow us to use this object to pass the view_only id to the topic view serializer
    Guardian.class_eval do
        attr_accessor :view_only_id
    end

    EmbedController.class_eval do
        old_comments = self.instance_method(:comments)
        define_method(:comments) do
            # ensure the user is allowed to see these comments
            topic_id = params[:topic_id].to_i
            topic = Topic.find_by(id: topic_id)
            raise Discourse::NotFound unless topic

            if topic.parent_guids
                project_guid = topic.parent_guids[0]
                raise Discourse::NotFound if params[:view_only] && !OsfProjects::can_view(topic, params[:view_only])
                raise Discourse::NotFound unless params[:view_only] || topic.project_is_public ||
                        OsfProjects::can_create_topic_in_project(topic.parent_groups[0], current_user)
            end

            @queryString = params[:view_only] ? '?view_only=' + params[:view_only] : ''

            old_comments.bind(self).call
        end
    end

    # Register these custom fields so that they will allowed as parameters
    # We don't pass a block so that these guids
    # to be changed in the future.
    PostRevisor.track_topic_field(:parent_guids) do |tc, parent_guids|
        parent_guids = parent_guids.map { |guid| OsfProjects::clean_guid(guid) }
        tc.topic.custom_fields.update(PARENT_GUIDS_FIELD_NAME => "-#{parent_guids.join('-')}-")
        tc.topic.custom_fields.update(PROJECT_GUID_FIELD_NAME => parent_guids[0])
    end
    PostRevisor.track_topic_field(:topic_guid)

    # Hook onto topic creation to save our custom fields
    on(:before_create_topic) do |topic, topic_creator|
        user = topic_creator.user
        params = topic_creator.opts

        next unless params[:parent_guids]
        parent_guids = params[:parent_guids].map { |guid| OsfProjects::clean_guid(guid) }

        unless user.staff?
            next unless OsfProjects::can_create_project_topic(parent_guids[0], user)
        end

        if params[:topic_guid]
            topic_guid = OsfProjects::clean_guid(params[:topic_guid])
            topic.custom_fields.update(TOPIC_GUID_FIELD_NAME => topic_guid)
        end

        topic.custom_fields.update(PARENT_GUIDS_FIELD_NAME => "-#{parent_guids.join('-')}-")
        topic.custom_fields.update(PROJECT_GUID_FIELD_NAME => parent_guids[0])
    end

    Group.class_eval do
        has_many :group_custom_fields
    end

    # Add methods for directly extracting these fields
    # and making them accessible to the TopicViewSerializer
    Topic.class_eval do
        has_many :topic_custom_fields
        has_one :excerpt_post, -> {where(post_number: 2)}, class_name: 'Post'
        attr_writer :parent_groups
        attr_writer :parent_names

        def parent_groups
            # hopefully already preloaded
            return @parent_groups if @parent_groups

            unordererd_groups = Group.where(name: parent_guids).preload(:group_custom_fields).to_a
            @parent_groups = parent_guids.map {|guid| unordererd_groups.select {|group| group.name == guid }.first}
        end

        def parent_names
            # hopefully already preloaded
            return @parent_names if @parent_names

            parent_topics = Topic.select('title, tc.value as t_guid')
                            .joins('LEFT JOIN topic_custom_fields AS tc ON (topics.id = tc.topic_id)')
                            .references('tc')
                            .where('tc.name = ? AND tc.value IN (?)', TOPIC_GUID_FIELD_NAME, parent_guids)
                            .to_a

            @parent_names = parent_guids.map do |guid|
                parent_topic = parent_topics.select {|topic| topic.t_guid == guid }.first
                parent_topic.title if parent_topic
            end
        end

        def topic_excerpt
            excerpt_post.excerpt(200) if excerpt_post
        end
        def parent_guids
            parent_guids_str = topic_custom_fields.select { |a| a.name == PARENT_GUIDS_FIELD_NAME }.first
            return [] unless parent_guids_str
            parent_guids_str.value.split('-').delete_if { |s| s.length == 0 }
        end
        def project_guid
            custom_field = topic_custom_fields.select { |a| a.name == PROJECT_GUID_FIELD_NAME }.first
            custom_field.value if custom_field
        end
        def topic_guid
            custom_field = topic_custom_fields.select { |a| a.name == TOPIC_GUID_FIELD_NAME }.first
            custom_field.value if custom_field
        end
        def project_name
            parent_names[0] if parent_names
        end
        def project_is_public
            return true if parent_groups == [] # Not in a project, not private.
            parent_groups.first.visible
        end
        def contributors
            return @contributors if @contributors != nil
            @contributors = OsfProjects::contributors_for_project(project_guid) if project_guid
        end
        def excerpt_mentioned_users
            # unlikely for there to be a contributor in the excerpt, so only load contributors if there is a mention
            return unless topic_excerpt
            topic_excerpt.scan(/@[a-z0-9]+/).map { |u|
                contributors.select {|c| c[:username] == u[1..-1] }
            }.uniq.flatten
        end

        # override
        def slug
            slug = topic_guid ? topic_guid : Slug.for(title)
            unless read_attribute(:slug) == slug
              if new_record?
                write_attribute(:slug, slug)
              else
                update_column(:slug, slug)
              end
            end
            slug
        end

        # Override the default results for permissions control
        old_secured = self.method(:secured)
        scope :secured, lambda { |guardian=nil|
            results = old_secured.call

            results = results.preload(:topic_custom_fields)
            results = results.preload(:excerpt_post)
            results = OsfProjects::preload_parent_groups(results)
            results = OsfProjects::preload_parent_names(results)

            OsfProjects::allowed_project_topics(results, guardian ? guardian.user : nil)
        }
    end
    add_to_serializer(:topic_view, :contributors) { object.topic.contributors }

    TopicCreator.class_eval do
        # Override topic creation to avoid creating multiple topics with the same topic_guid
        old_create = self.instance_method(:create)
        define_method(:create) do
            topic = OsfProjects::topic_for_guid(@opts[:topic_guid]) if @opts[:topic_guid]
            if topic
                topic.recover! if topic.deleted_at.present?
                return topic
            end

            old_create.bind(self).call
        end
    end

    # Register these Topic attributes to appear on the Topic page
    TopicViewSerializer.attributes_from_topic(:topic_guid)
    TopicViewSerializer.attributes_from_topic(:project_is_public)
    TopicViewSerializer.attributes_from_topic(:parent_guids)
    TopicViewSerializer.attributes_from_topic(:parent_names)

    # Register these to appear on the TopicList page/the SuggestedTopics for _each item_ on the topic
    # For some reason it doesn't work to add these to the parent serializer listable_topic
    # in production mode, although that works just fine in development mode. :/
    add_to_serializer(:topic_list_item, :project_guid) { object.project_guid }
    add_to_serializer(:topic_list_item, :topic_guid) { object.topic_guid }
    add_to_serializer(:topic_list_item, :project_name) { object.project_name }
    add_to_serializer(:topic_list_item, :project_is_public) { object.project_is_public }
    add_to_serializer(:topic_list_item, :excerpt) { object.topic_excerpt }
    add_to_serializer(:topic_list_item, :excerpt_mentioned_users) { object.excerpt_mentioned_users }

    add_to_serializer(:suggested_topic, :project_guid) { object.project_guid }
    add_to_serializer(:suggested_topic, :topic_guid) { object.topic_guid }
    add_to_serializer(:suggested_topic, :project_name) { object.project_name }
    add_to_serializer(:suggested_topic, :project_is_public) { object.project_is_public }
    add_to_serializer(:suggested_topic, :excerpt) { object.topic_excerpt }
    add_to_serializer(:suggested_topic, :excerpt_mentioned_users) { object.excerpt_mentioned_users }

    # Mark as preloaded so they are included in the SQL queries
    if TopicList.respond_to? :preloaded_custom_fields
        TopicList.preloaded_custom_fields << PARENT_GUIDS_FIELD_NAME
        TopicList.preloaded_custom_fields << TOPIC_GUID_FIELD_NAME
        TopicList.preloaded_custom_fields << PROJECT_GUID_FIELD_NAME
    end

    require_dependency 'application_controller'
    require_dependency 'topic_list_responder'
    require_dependency 'topic_query'

    # Add custom topic list attributes and add register them to be output by the serializer
    # This data is output once for the entire topic list
    TopicList.class_eval do
        attr_accessor :parent_guids
        attr_accessor :parent_names
        attr_accessor :project_is_public

        def can_create_topic
            return false unless @current_user
            @current_user.guardian.can_create?(Topic) &&
                parent_guids &&
                OsfProjects::can_create_project_topic(parent_guids[0], @current_user)
        end
        def contributors
            OsfProjects::contributors_for_project(parent_guids[0]) if parent_guids
        end
    end
    add_to_serializer(:topic_list, :parent_guids) { object.parent_guids }
    add_to_serializer(:topic_list, :parent_names) { object.parent_names }
    add_to_serializer(:topic_list, :project_is_public) { object.project_is_public }
    add_to_serializer(:topic_list, :can_create_topic) { object.can_create_topic }
    add_to_serializer(:topic_list, :contributors) { object.contributors }

    TopicQuery.class_eval do
        def latest_project_results(project_guid)
            result = default_project_results(project_guid)
            remove_muted_topics(result, @user)
        end

        def unread_project_results(project_guid)
            result = default_project_results(project_guid)
            result = TopicQuery.unread_filter(result)
            suggested_ordering(result, {})
        end

        def new_project_results(project_guid)
            result = default_project_results(project_guid)
            result = TopicQuery.new_filter(result, @user.user_option.treat_as_new_topic_start_date)
            result = remove_muted_topics(result, @user)
            suggested_ordering(result, {})
        end

        def read_project_results(project_guid)
            default_project_results(project_guid).order('COALESCE(tu.last_visited_at, topics.bumped_at) DESC')
        end

        def posted_project_results(project_guid)
            default_project_results(project_guid).where('tu.posted')
        end

        def bookmarks_project_results(project_guid)
            default_project_results(project_guid).where('tu.bookmarked')
        end

        def list_project_top_for(project_guid, period)
            score = "#{period}_score"
            create_list(:top, unordered: true, topics: default_project_results(project_guid)) do |topics|
                topics = topics.joins(:top_topic).where("top_topics.#{score} > 0")
                if period == :yearly && @user.try(:trust_level) == TrustLevel[0]
                    topics.order(TopicQuerySQL.order_top_with_pinned_category_for(score))
                else
                    topics.order(TopicQuerySQL.order_top_for(score))
                end
            end
        end

        # Override the default results for permissions control
        old_default_results = self.instance_method(:default_results)
        define_method(:default_results) do |options={}|
            results = old_default_results.bind(self).call(options)
            results = results.includes(:category).references(:categories)

            results = results.preload(:topic_custom_fields)
            results = results.preload(:excerpt_post)
            results = OsfProjects::preload_parent_groups(results)
            results = OsfProjects::preload_parent_names(results)

            results = OsfProjects::allowed_project_topics(results, @user)
        end

        # We use the plain default results to avoid a the complex work of determining
        # all allowed topics when actually we are just interested in one project
        define_method(:default_project_results) do |project_guid|
            results = old_default_results.bind(self).call

            results = results.preload(:topic_custom_fields)
            results = results.preload(:excerpt_post)
            results = OsfProjects::preload_parent_groups(results)
            results = OsfProjects::preload_parent_names(results)

            OsfProjects::filter_to_project(project_guid, results)
        end
    end

    # Override show to implement project permission control
    TopicsController.class_eval do
        old_show = self.instance_method(:show)
        define_method(:show) do
            topic = Topic.where(id: params[:topic_id] || params[:id])

            topic = topic.first
            if topic == nil
                slug = params[:slug] || params[:id]
                topic = Topic.find_by(slug: slug.downcase) if slug
            end
            raise Discourse::NotFound if topic == nil

            if topic.parent_guids
                project_guid = topic.parent_guids[0]
                raise Discourse::NotFound if params[:view_only] && !OsfProjects::can_view(topic, params[:view_only])
                raise Discourse::NotFound unless params[:view_only] || topic.project_is_public ||
                        OsfProjects::can_create_topic_in_project(topic.parent_groups[0], current_user)
            end

            # The serializer needs this in order to determine if the user can see parent projects.
            # About the only place we can put it to get to the serializer is in the guardian.
            guardian.view_only_id = params[:view_only]

            old_show.bind(self).call
        end
    end

    ListController.class_eval do
        # Expose private methods
        def self.get_best_period_for(previous_visit_at, category_id=nil)
            ListController.best_period_for(previous_visit_at, category_id)
        end
    end

    # Routing for the project specific end-points
    OsfProjects::Engine.routes.draw do
        get '/' => 'projects#index'
        constraints(project_guid: /[a-z0-9]+/) do
            get '/:project_guid' => 'projects#show'
            get '/:project_guid/c/:category' => 'projects#show'
            get '/:project_guid/c/:parent_category/:category' => 'projects#show'
            delete '/:project_guid' => 'projects#delete'
            put '/:project_guid' => 'projects#update'
            Discourse.filters.each do |filter|
                get "/:project_guid/#{filter}" => "projects#show_#{filter}"
                get "/:project_guid/c/:category/l/#{filter}" => "projects#show_#{filter}"
                get "/:project_guid/c/:parent_category/:category/l/#{filter}" => "projects#show_#{filter}"
            end

            get "/:project_guid/top" => "projects#top"
            get "/:project_guid/c/:category/l/top" => "projects#top"
            get "/:project_guid/c/:parent_category/:category/l/top" => "projects#top"
            TopTopic.periods.each do |period|
                get "/:project_guid/top/#{period}" => "projects#top_#{period}"
                get "/:project_guid/c/:category/l/top/#{period}" => "projects#top_#{period}"
                get "/:project_guid/c/:parent_category/:category/l/top/#{period}" => "projects#top_#{period}"
            end
        end
    end

    Discourse::Application.routes.append do
        mount OsfProjects::Engine, at: '/forum' #/projects
    end

    class ::OsfProjects::ProjectsController < ::ApplicationController
        include ::TopicListResponder
        requires_plugin 'discourse-osf-projects'

        PAGE_SIZE = 50

        # Tries to make sure show can be called through an XHR?
        skip_before_filter :check_xhr, only: [:show]

        def index
            render json: {}
        end

        def delete
            project_guid = OsfProjects::clean_guid(params[:project_guid])
            project_topic = OsfProjects::topic_for_guid(project_guid)
            raise Discourse::NotFound unless project_topic && (project_topic.deleted_at.nil? || project_topic.deleted_by_id.present?)
            raise Discourse::NotFound unless OsfProjects::can_create_topic_in_project(project_topic.parent_groups[0], current_user)

            # 'Trashing' every single project in the topic allows them to be later recovered,
            # but will make the project appear completely gone
            project_topics = OsfProjects::filter_to_project(project_guid, Topic)
            project_topics.all.each { |t| t.trash! }

            render nothing: true
        end

        def update
            project_guid = OsfProjects::clean_guid(params[:project_guid])
            project_topic = OsfProjects::topic_for_guid(project_guid)
            project_group = project_topic.parent_groups[0] if project_topic

            raise Discourse::NotFound unless project_group == nil || OsfProjects::can_create_topic_in_project(project_group, current_user)

            unless project_group
                project_group = Group.new
                project_group.name = project_guid
            end

            project_group.visible = (params[:is_public] == 'true') if params[:is_public].present?
            if params[:view_only_keys]
                project_group.custom_fields.update(VIEW_ONLY_KEYS_FIELD_NAME => "-#{params[:view_only_keys].join('-')}-")
            end
            project_group.usernames = params[:contributors] if params[:contributors]
            project_group.save

            # Calling this update endpoint effectively recovers a deleted/trashed project
            if project_topic && project_topic.deleted_at.present?
                project_topics = OsfProjects::filter_to_project(project_guid, Topic.with_deleted)
                project_topics.all.each { |t| t.recover! if t.deleted_by_id.nil? }
            end

            render nothing: true
        end

        # [:latest, :unread, :new, :read, :posted, :bookmarks]
        Discourse.filters.each do |filter|
            define_method("show_#{filter}") do
                project_guid = OsfProjects::clean_guid(params[:project_guid])
                project_topic = OsfProjects::topic_for_guid(project_guid)
                raise Discourse::NotFound unless project_topic && project_topic.deleted_at.nil?

                project_is_public = project_topic.project_is_public
                # Raise an error if the view only id is invalid -- that makes this easier to debug.
                raise Discourse::NotFound if params[:view_only] && !OsfProjects::can_view(project_topic, params[:view_only])
                raise Discourse::NotFound unless params[:view_only] || project_is_public ||
                        OsfProjects::can_create_topic_in_project(project_topic.parent_groups[0], current_user)


                parent_guids = project_topic.parent_guids
                # parent_topics will become out of order, but names_for_topics restores order
                parent_topics = OsfProjects::topics_for_guids(parent_guids)
                parent_topics = OsfProjects::filter_viewable_topics(parent_topics, current_user, params[:view_only])
                parent_names, parent_guids = OsfProjects::names_guids_for_topics(parent_guids, parent_topics)

                list_options = {
                    per_page: PAGE_SIZE,
                    limit: true,
                }
                list_options.merge!(build_topic_list_options)
                query = TopicQuery.new(current_user, list_options)

                result = query.send("#{filter}_project_results", project_guid)

                options = {}
                if filter == :read || filter == :unread || filter == :new
                    options = {unordered: true}
                end

                # the fully qualified filter name is used to pass mark the data in the preload store
                # so that it will be correctly used by the front end
                list = query.create_list("forum/#{project_guid}/#{filter}", options, result)
                list.parent_guids = parent_guids
                list.parent_names = parent_names
                list.project_is_public = project_is_public

                respond_with_list(list)
            end
        end

        def show
            show_latest
        end

        TopTopic.periods.each do |period|
            define_method("top_#{period}") do |options = nil|
                project_guid = OsfProjects::clean_guid(params[:project_guid])
                project_topic = OsfProjects::topic_for_guid(project_guid)
                raise Discourse::NotFound unless project_topic && project_topic.deleted_at.nil?

                project_is_public = project_topic.project_is_public
                raise Discourse::NotFound if params[:view_only] && !OsfProjects::can_view(project_topic, params[:view_only])
                raise Discourse::NotFound unless params[:view_only] || project_is_public ||
                        OsfProjects::can_create_topic_in_project(project_topic.parent_groups[0], current_user)

                parent_guids = project_topic.parent_guids
                # parent_topics will become out of order, but names_for_topics restores order
                parent_topics = OsfProjects::topics_for_guids(parent_guids)
                parent_topics = OsfProjects::filter_viewable_topics(parent_topics, current_user, params[:view_only])
                parent_names, parent_guids = OsfProjects::names_guids_for_topics(parent_guids, parent_topics)

                list_options = {
                    per_page: SiteSetting.topics_per_period_in_top_page,
                    limit: true,
                }
                list_options.merge!(build_topic_list_options)
                list_options.merge!(options) if options
                if 'top'.freeze == current_homepage
                  list_options[:exclude_category_ids] = get_excluded_category_ids(list_options[:category])
                end

                list = TopicQuery.new(current_user, list_options).list_project_top_for(project_guid, period)
                list.for_period = period
                #list.more_topics_url = construct_url_with(:next, list_options)
                #list.prev_topics_url = construct_url_with(:prev, list_options)

                list.parent_guids = parent_guids
                list.parent_names = parent_names
                list.project_is_public = project_is_public

                respond_with_list(list)
            end
        end

        def top(options=nil)
            options ||= {}
            period = ListController.get_best_period_for(current_user.try(:previous_visit_at), options[:category])
            send("top_#{period}", options)
        end

        def build_topic_list_options
            options = {
                page: params[:page],
                topic_ids: param_to_integer_list(:topic_ids),
                exclude_category_ids: params[:exclude_category_ids],
                category: params[:category],
                order: params[:order],
                ascending: params[:ascending],
                min_posts: params[:min_posts],
                max_posts: params[:max_posts],
                status: params[:status],
                filter: params[:filter],
                state: params[:state],
                search: params[:search],
                q: params[:q]
            }
            options[:no_subcategories] = true if params[:no_subcategories] == 'true'
            options[:slow_platform] = true if slow_platform?

            options
        end
    end

    # With usernames being guids, we need to send real name too
    PostSerializer.class_eval do
        old_reply_to_user = self.instance_method(:reply_to_user)
        define_method(:reply_to_user) do
            data = old_reply_to_user.bind(self).call
            data[:name] = object.reply_to_user.name
            data
        end
    end

    # modifying the singleton class instance
    old_lookup_columns = AvatarLookup.public_method(:lookup_columns)
    AvatarLookup.define_singleton_method(:lookup_columns) do
        # We need to have this lookup the name attribute of users
        # So that it is available to be serialized by the BasicUserSerializer
        # So we can have the full name of the reply_to_user above
        old_lookup_columns.call << :name
    end
    add_to_serializer(:basic_user, :name) { user.name }

    # We need these messages to also send project information to determine whether they affect the user
    TopicTrackingState.class_eval do
        def self.publish_new(topic)
            message = {
                topic_id: topic.id,
                message_type: 'new_topic',
                payload: {
                    last_read_post_number: nil,
                    highest_post_number: 1,
                    created_at: topic.created_at,
                    topic_id: topic.id,
                    category_id: topic.category_id,
                    archetype: topic.archetype,
                    project_guid: topic.project_guid,
                    project_is_public: topic.project_is_public
                }
            }

            group_ids = topic.category && topic.category.secure_group_ids

            MessageBus.publish('/new', message.as_json, group_ids: group_ids)
            publish_read(topic.id, 1, topic.user_id)
        end

        def self.publish_latest(topic)
            return unless topic.archetype == 'regular'

            message = {
                topic_id: topic.id,
                message_type: 'latest',
                payload: {
                    bumped_at: topic.bumped_at,
                    topic_id: topic.id,
                    category_id: topic.category_id,
                    archetype: topic.archetype,
                    project_guid: topic.project_guid,
                    project_is_public: topic.project_is_public
                }
            }

            group_ids = topic.category && topic.category.secure_group_ids
            MessageBus.publish('/latest', message.as_json, group_ids: group_ids)
        end
    end

    Search.class_eval do
        advanced_filter(/project:([a-zA-Z0-9]*)/) do |posts,match|
            @project_guid = match
            posts.joins('LEFT JOIN topic_custom_fields AS tc2 ON (posts.topic_id = tc2.topic_id)')
                  .where('tc2.name = ? AND tc2.value LIKE ?', PARENT_GUIDS_FIELD_NAME, "%-#{match}-%")
        end

        advanced_filter(/view_only:([a-zA-Z0-9]*)/) do |posts,match|
            @view_only = match
            posts
        end

        old_posts_query = self.instance_method(:posts_query)
        define_method(:posts_query) do |limit, opts=nil|
            posts = old_posts_query.bind(self).call(limit, opts)
            if @project_guid
                project_topic = OsfProjects::topic_for_guid(@project_guid)
                return Post.none unless project_topic && project_topic.deleted_at.nil?

                project_is_public = project_topic.project_is_public

                return Post.none if @view_only && !OsfProjects::can_view(project_topic, @view_only)
                return Post.none unless @view_only || project_is_public ||
                        OsfProjects::can_create_topic_in_project(project_topic.parent_groups[0], @guardian.user)
                return posts
            end
            OsfProjects::allowed_project_posts(posts, @guardian.user)
        end
    end
end
